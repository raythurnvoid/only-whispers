import { getCloudModel } from "./ModelRegistry";
import type { ReasoningConfig } from "../services/BaseReasoningService";

/**
 * The effort the user picked for this scope, when the model offers a choice of
 * levels. A stored level it doesn't offer (the model changed since) is ignored.
 */
export function chosenReasoningEffort(model: string, config: ReasoningConfig): string | undefined {
  const options = getCloudModel(model)?.reasoningEffort?.options ?? [];
  const effort = config.reasoningEffort;
  return effort && options.length > 1 && options.includes(effort) ? effort : undefined;
}
