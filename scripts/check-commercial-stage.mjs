import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/commercial-stage.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourcePath,
});

const cjsModule = { exports: {} };
const execute = new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText);
execute(cjsModule.exports, require, cjsModule, sourcePath, path.dirname(sourcePath));

const {
  classifyCommercialStage,
  buildNegotiationAdvanceReply,
  isPassiveNegotiationReply,
  shouldOverrideNegotiationReply,
  shouldOverrideCommercialReply,
  buildCommercialStagePromptSection,
  buildCommercialConversationContext,
  buildCommercialConversationContextPromptSection,
  commercialStageFixtures,
} = cjsModule.exports;

for (const fixture of commercialStageFixtures) {
  const result = classifyCommercialStage({ latestUserMessage: fixture.input });
  assert.equal(result.currentStage, fixture.expectedStage, `Expected ${fixture.input} -> ${fixture.expectedStage}`);
}

const negotiationReply = buildNegotiationAdvanceReply({
  latestUserMessage: "voy a hablar con mi marido",
  activeProductContext: { productName: "Combo Camillas" },
});

assert.ok(negotiationReply.includes("?"), "Negotiation reply must ask a commercial question.");
assert.equal(isPassiveNegotiationReply(negotiationReply), false, "Negotiation reply must not be passive.");
assert.equal(shouldOverrideNegotiationReply("Perfecto, tomate tu tiempo..."), true, "Passive reply must be overridden.");
assert.equal(shouldOverrideNegotiationReply(negotiationReply), false, "Good negotiation reply must be kept.");

const advancedContext = buildCommercialConversationContext({
  stage: {
    currentStage: "EXPOSICION",
    previousStage: "DIAGNOSTICO",
    reason: "price shown and product presented",
    confidence: 80,
    signals: ["precio", "fotos"],
    updatedAt: new Date().toISOString(),
    lastUserMessage: "precio",
    profile: {
      stage: "EXPOSICION",
      objective: "",
      capture: [],
      avoid: [],
      nextStep: "Ask the best-fit option",
    },
  },
  latestUserMessage: "Mañana lo voy a ver",
  history: [
    { direction: "OUTBOUND", content: "Te comparto las fotos del combo camillas." },
    { direction: "OUTBOUND", content: "Para el Combo Camillas el precio es $989.000." },
    { direction: "OUTBOUND", content: "¿En que ciudad estas para informarte sobre el envio?" },
    { direction: "INBOUND", content: "Mañana lo voy a ver" },
  ],
  activeProductContext: { productName: "Combo Camillas", slug: "combo-camillas", price: "$989.000" },
});

assert.equal(advancedContext.shownPrice, true, "Commercial context should detect price shown.");
assert.equal(advancedContext.askedCityOrShipping, true, "Commercial context should detect city / shipping question.");
assert.equal(advancedContext.objectionDetected, true, "Commercial context should detect a purchase pause.");

assert.equal(
  classifyCommercialStage({
    latestUserMessage: "Mañana lo voy a ver",
    history: [
      { direction: "OUTBOUND", content: "Te comparto las fotos del combo camillas." },
      { direction: "OUTBOUND", content: "Para el Combo Camillas el precio es $989.000." },
      { direction: "OUTBOUND", content: "¿En que ciudad estas para informarte sobre el envio?" },
      { direction: "INBOUND", content: "Mañana lo voy a ver" },
    ],
    activeProductContext: { productName: "Combo Camillas", description: "Camilla fija dos cuerpos", price: "$989.000" },
    commercialContext: advancedContext,
    previousStage: "EXPOSICION",
  }).currentStage,
  "NEGOCIACION",
  "Advanced context with a pause should classify as negotiation.",
);

assert.equal(
  shouldOverrideCommercialReply(
    "Perfecto, volvamos a lo principal: que servicios vas a ofrecer con la camilla?",
    advancedContext,
  ),
  true,
  "Repeated opening should be overridden when the conversation is already advanced.",
);

const commercialContextPrompt = buildCommercialConversationContextPromptSection(advancedContext);
assert.ok(commercialContextPrompt.includes("CONTEXTO COMERCIAL ACUMULADO"), "Commercial context prompt should be built.");

const negotiationPrompt = buildCommercialStagePromptSection({
  currentStage: "NEGOCIACION",
  previousStage: "EXPOSICION",
  reason: "purchase pause",
  confidence: 90,
  signals: ["voy a hablar con mi marido"],
  updatedAt: new Date().toISOString(),
  lastUserMessage: "voy a hablar con mi marido",
});

assert.ok(negotiationPrompt.includes("NEGOCIACION"), "Prompt section should describe negotiation stage.");
assert.ok(negotiationPrompt.includes("passive phrases"), "Prompt section should warn about passive phrases.");

console.log("commercial-stage checks passed");
