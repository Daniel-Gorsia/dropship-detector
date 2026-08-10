export { runScan } from "./agent.js";
export type { AgentConfig, ScanResult } from "./agent.js";
export { getStoreFingerprint } from "./signals/fingerprint.js";
export { getDomainAge } from "./signals/domain-age.js";
export { checkShippingPolicy } from "./signals/shipping.js";
export { checkDescriptionPlagiarism } from "./signals/description-plagiarism.js";
export { findSupplierMatches } from "./source-finder.js";
export { reverseImageSearch, googleShoppingSearch, searchByText } from "./signals/serp.js";
export { normalizeUrl, extractDomain } from "./fetch.js";

// Provider swap: change this one import to switch models
// import { createAnthropic } from "@ai-sdk/anthropic";
// import { createOpenAI } from "@ai-sdk/openai";
