class MainWindowPlacementCoordinator {
  constructor() {
    this._requestId = 0;
  }

  cancelPending() {
    this._requestId += 1;
  }

  async request(resolvePlacement, applyPlacement) {
    const requestId = ++this._requestId;
    const isCurrent = () => requestId === this._requestId;
    const placement = await resolvePlacement();

    if (!isCurrent()) {
      return { applied: false, reason: "superseded" };
    }

    return applyPlacement(placement, isCurrent);
  }
}

module.exports = MainWindowPlacementCoordinator;
