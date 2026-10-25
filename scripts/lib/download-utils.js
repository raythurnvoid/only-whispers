const https = require("https");
const fs = require("fs");
const { execSync } = require("child_process");

const REQUEST_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const MAX_REDIRECTS = 5;
const RELEASE_PAGE_SIZE = 100;
const MAX_RELEASE_PAGES = 20;

// Node's global agent keeps sockets alive, and a socket only returns to the pool (where it
// stops holding the event loop open) once its response has been read to the end. A redirect
// or error body we never read pins the socket until the server drops it, often for minutes.
function discardBody(response) {
  response.resume();
}

/**
 * Fetch JSON and response headers from a URL.
 * @param {string} url - URL to fetch
 * @param {number} [redirectCount=0] - Current redirect count (internal use)
 * @returns {Promise<{json: object, headers: object}>}
 */
function fetchJsonResponse(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error("Too many redirects"));
      return;
    }

    const headers = {
      "User-Agent": "only-whispers-Downloader",
      Accept: "application/vnd.github+json",
    };

    // Use GitHub token if available (increases rate limit from 60 to 5000/hour)
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const options = {
      headers,
      timeout: REQUEST_TIMEOUT,
    };

    https
      .get(url, options, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          discardBody(res);
          const location = res.headers.location;
          if (!location) {
            reject(new Error("Redirect without location header"));
            return;
          }
          const redirectUrl = location.startsWith("/") ? new URL(location, url).href : location;
          fetchJsonResponse(redirectUrl, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          discardBody(res);
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ json: JSON.parse(data), headers: res.headers });
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        });
        res.on("error", reject);
      })
      .on("error", reject)
      .on("timeout", function onTimeout() {
        // Destroying rejects through the "error" handler and frees the stalled socket.
        this.destroy(new Error("Request timeout"));
      });
  });
}

function fetchJson(url) {
  return fetchJsonResponse(url).then((response) => response.json);
}

/**
 * Return the next URL from a GitHub `Link` header, or null when this is the last page.
 * @param {string | undefined} linkHeader
 * @returns {string | null}
 */
function parseGithubNextLink(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(",")) {
    if (!/rel=["']?next["']?/i.test(part)) {
      continue;
    }
    const match = part.match(/<([^>]+)>/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * First non-draft release whose tag starts with `tagPrefix`.
 * GitHub lists releases newest-first, so the first hit is the latest match.
 * @param {unknown} releases
 * @param {string} tagPrefix
 * @param {boolean} includePrerelease
 * @returns {object | null}
 */
function matchReleaseByPrefix(releases, tagPrefix, includePrerelease) {
  if (!Array.isArray(releases)) {
    return null;
  }

  for (const release of releases) {
    if (release.draft) continue;
    if (!includePrerelease && release.prerelease) continue;
    if (release.tag_name && release.tag_name.startsWith(tagPrefix)) {
      return release;
    }
  }

  return null;
}

/**
 * Fetch a release from a GitHub repository.
 * @param {string} repo - Repository in "owner/repo" format
 * @param {object} options - Options
 * @param {string} [options.tag] - Exact tag to fetch (works for any release age, no pagination)
 * @param {string} [options.tagPrefix] - Latest release whose tag starts with this prefix (walks GitHub release pages)
 * @param {boolean} [options.includePrerelease=false] - Include prereleases (tagPrefix only)
 * @returns {Promise<{tag: string, assets: Array<{name: string, url: string}>, url: string} | null>}
 */
async function fetchLatestRelease(repo, options = {}) {
  const { tag, tagPrefix, includePrerelease = false } = options;

  try {
    if (tag) {
      const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
      const release = await fetchJson(url);
      return formatRelease(release);
    }

    if (!tagPrefix) {
      const url = `https://api.github.com/repos/${repo}/releases/latest`;
      const release = await fetchJson(url);
      return formatRelease(release);
    }

    let pageUrl = `https://api.github.com/repos/${repo}/releases?per_page=${RELEASE_PAGE_SIZE}`;

    for (let page = 0; page < MAX_RELEASE_PAGES && pageUrl; page++) {
      const { json, headers } = await fetchJsonResponse(pageUrl);
      const match = matchReleaseByPrefix(json, tagPrefix, includePrerelease);
      if (match) {
        return formatRelease(match);
      }
      pageUrl = parseGithubNextLink(headers.link);
    }

    return null;
  } catch (error) {
    console.error(`  Failed to fetch latest release for ${repo}: ${error.message}`);
    return null;
  }
}

/**
 * Format a GitHub release response into a simplified object.
 * @param {object} release - GitHub release API response
 * @returns {{tag: string, assets: Array<{name: string, url: string}>, url: string}}
 */
function formatRelease(release) {
  return {
    tag: release.tag_name,
    url: release.html_url,
    assets: (release.assets || []).map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
    })),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadFile(url, dest, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let activeRequest = null;

    const cleanup = () => {
      if (activeRequest) {
        activeRequest.destroy();
        activeRequest = null;
      }
      file.close();
    };

    const request = (currentUrl, redirectCount = 0) => {
      if (redirectCount > MAX_REDIRECTS) {
        cleanup();
        reject(new Error("Too many redirects"));
        return;
      }

      const req = https.get(currentUrl, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          discardBody(response);
          const location = response.headers.location;
          if (!location) {
            cleanup();
            reject(new Error("Redirect without location header"));
            return;
          }
          const redirectUrl = location.startsWith("/")
            ? new URL(location, currentUrl).href
            : location;
          request(redirectUrl, redirectCount + 1);
          return;
        }

        if (response.statusCode !== 200) {
          cleanup();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const total = parseInt(response.headers["content-length"], 10);
        let downloaded = 0;

        response.on("data", (chunk) => {
          downloaded += chunk.length;
          const pct = total ? Math.round((downloaded / total) * 100) : 0;
          process.stdout.write(`\r  Downloading: ${pct}%`);
        });

        response.on("error", (err) => {
          cleanup();
          reject(err);
        });

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          console.log(" Done");
          resolve();
        });

        file.on("error", (err) => {
          cleanup();
          reject(err);
        });
      });

      activeRequest = req;

      // A redirect we already followed can still error or time out while its body drains;
      // that must not tear down the request that replaced it.
      req.on("error", (err) => {
        if (req !== activeRequest) return;
        cleanup();
        reject(err);
      });

      req.setTimeout(REQUEST_TIMEOUT, () => {
        if (req !== activeRequest) {
          req.destroy();
          return;
        }
        cleanup();
        reject(new Error("Connection timed out"));
      });
    };

    request(url);
  }).catch(async (error) => {
    const isTransient =
      error.message.includes("timed out") ||
      error.code === "ECONNRESET" ||
      error.code === "ETIMEDOUT";

    if (isTransient && retryCount < MAX_RETRIES) {
      console.log(`\n  Retry ${retryCount + 1}/${MAX_RETRIES}: ${error.message}`);
      await sleep(RETRY_DELAY);
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
      return downloadFile(url, dest, retryCount + 1);
    }
    throw error;
  });
}

async function extractZip(zipPath, destDir) {
  if (process.platform === "win32") {
    // Use unzipper package on Windows for better path handling
    const unzipper = require("unzipper");
    await fs
      .createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destDir }))
      .promise();
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "inherit" });
  }
}

function extractTarGz(tarPath, destDir) {
  execSync(`tar -xzf "${tarPath}" -C "${destDir}"`, { stdio: "inherit" });
}

async function extractArchive(archivePath, destDir) {
  if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
    extractTarGz(archivePath, destDir);
  } else {
    await extractZip(archivePath, destDir);
  }
}

function setExecutable(filePath) {
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o755);
  }
}

module.exports = {
  downloadFile,
  extractArchive,
  extractZip,
  fetchLatestRelease,
  setExecutable,
};
