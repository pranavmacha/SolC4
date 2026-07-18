/**
 * Demo AI response generators — produce realistic assistant and briefing
 * responses from scenario snapshots when no real provider is configured.
 */
const {
  highestSeverityIncident,
  leastCrowdedZone,
  mostCrowdedZone
} = require("./snapshot");

function generateDemoAssistant(payload, snapshot) {
  const persona = String(payload.persona || "Fan");
  const question = String(payload.question || "What should I do next?");
  const language = String(payload.language || "English");
  const zone = snapshot.zones.find(item => item.id === (payload.selectedZone && payload.selectedZone.id)) || mostCrowdedZone(snapshot.zones);
  const crowded = mostCrowdedZone(snapshot.zones);
  const calm = leastCrowdedZone(snapshot.zones);
  const riskLevel = riskFromDensity(crowded.density);
  const accessibility = payload.accessibility || {};

  const actions = [];
  if (accessibility.stepFree) {
    actions.push(`Use the step-free path via ${zone.accessible || calm.accessible || "the accessibility hub"}.`);
  }
  if (accessibility.lowSensory) {
    actions.push(`Avoid ${crowded.name}; route through ${calm.name} where crowd density is ${calm.density}%.`);
  }
  if (persona.toLowerCase().includes("volunteer")) {
    actions.push(`Stage two volunteers at ${crowded.name} for queue translation and reassurance.`);
  } else if (persona.toLowerCase().includes("staff") || persona.toLowerCase().includes("organizer")) {
    actions.push(`Open overflow signage toward ${calm.name} and monitor ${crowded.name} every 3 minutes.`);
  } else {
    actions.push(`Head toward ${calm.name}; current wait is about ${calm.wait} minutes.`);
  }
  if (accessibility.audioDescription) {
    actions.push("Enable audio-description announcements and repeat gate changes in short plain-language phrases.");
  }
  actions.push("Prefer public transit or shared shuttle after the match to reduce curbside congestion.");

  return normalizeAssistantResult({
    headline: `${persona} guidance for ${zone.name || crowded.name}`,
    response: [
      `Language target: ${language}. Demo AI is using the live snapshot to answer: "${question}".`,
      `${crowded.name} is the busiest area at ${crowded.density}% density with an estimated ${crowded.wait}-minute wait.`,
      `${calm.name} is the best relief route right now at ${calm.density}% density.`,
      `Current venue context: ${snapshot.weather}; transport signal: ${snapshot.transit}.`
    ].join(" "),
    actions,
    riskLevel,
    escalation: riskLevel === "high" || riskLevel === "critical"
      ? `Escalate to crowd control lead for ${crowded.name} if density remains above 85% for 5 minutes.`
      : "No command escalation required; keep monitoring the selected zone.",
    confidence: "demo-high"
  }, "demo-ai");
}

function generateDemoBriefing(snapshot) {
  const crowded = mostCrowdedZone(snapshot.zones);
  const calm = leastCrowdedZone(snapshot.zones);
  const incident = highestSeverityIncident(snapshot.incidents);
  const riskLevel = riskFromDensity(crowded.density);
  const diversion = snapshot.sustainability?.diversion || "not reported";

  return normalizeBriefingResult({
    headline: `${snapshot.scenario}: ${riskLevel.toUpperCase()} crowd posture`,
    riskLevel,
    summary: `${crowded.name} is the current pressure point at ${crowded.density}% density and ${crowded.wait} minutes wait. ${calm.name} can absorb rerouted fans. ${snapshot.weather}. ${snapshot.transit}.`,
    priorities: [
      `Reduce load at ${crowded.name} with dynamic signage and multilingual volunteer prompts.`,
      `Keep accessibility routes open through ${calm.name}; verify elevators and step-free lanes.`,
      incident ? `Resolve "${incident.title}" in ${incident.zone}; owner ${incident.owner}, ETA ${incident.eta}.` : "No active incident needs command escalation.",
      `Push transit and refill-station nudges; current waste diversion is ${diversion}.`
    ],
    staffActions: [
      `Dispatch wayfinding team to ${crowded.name}.`,
      `Ask transport liaison to prepare post-match shuttle messaging.`,
      "Have volunteers repeat guidance in short phrases and point to visual signage."
    ],
    fanComms: `For fastest movement, use ${calm.name}. Step-free guests should follow ${calm.accessible || "the marked accessible route"}.`,
    sustainabilityNudge: "Recommend public transit, reusable cups, and refill points in post-match messages.",
    escalation: riskLevel === "critical"
      ? "Trigger command-center crowd mitigation protocol now."
      : riskLevel === "high"
        ? `Escalate if ${crowded.name} does not fall below 80% density within 5 minutes.`
        : "Continue routine monitoring."
  }, "demo-ai");
}

function normalizeAssistantResult(result, source) {
  return {
    source,
    headline: String(result?.headline || "AI matchday guidance"),
    response: String(result?.response || "No response generated."),
    actions: toArray(result?.actions),
    riskLevel: normalizeRisk(result?.riskLevel),
    escalation: String(result?.escalation || "No escalation recommended."),
    confidence: String(result?.confidence || (source === "configured-ai" ? "model-generated" : "demo")),
    generatedAt: new Date().toISOString()
  };
}

function normalizeBriefingResult(result, source) {
  return {
    source,
    headline: String(result?.headline || "Live operations briefing"),
    riskLevel: normalizeRisk(result?.riskLevel),
    summary: String(result?.summary || "No summary generated."),
    priorities: toArray(result?.priorities),
    staffActions: toArray(result?.staffActions),
    fanComms: String(result?.fanComms || "No fan communications drafted."),
    sustainabilityNudge: String(result?.sustainabilityNudge || "No sustainability nudge drafted."),
    escalation: String(result?.escalation || "No escalation recommended."),
    generatedAt: new Date().toISOString()
  };
}

function toArray(value) {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function riskFromDensity(density) {
  if (density >= 92) return "critical";
  if (density >= 82) return "high";
  if (density >= 65) return "medium";
  return "low";
}

function normalizeRisk(risk) {
  const value = String(risk || "").toLowerCase();
  return ["critical", "high", "medium", "low"].includes(value) ? value : "medium";
}

module.exports = {
  generateDemoAssistant,
  generateDemoBriefing,
  normalizeAssistantResult,
  normalizeBriefingResult,
  riskFromDensity
};
