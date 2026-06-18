import { readFileSync } from "node:fs";
import { assert } from "chai";
import { buildZoteroEnvironmentManifest } from "../src/codexAppServer/nativeClient";
import {
  buildAgentEvidenceContextBlock,
  clearAgentEvidenceCache,
  commitAgentCacheEvidenceActivities,
} from "../src/agent/context/cacheManagement";
import { buildAgentStableResourceContextBlock } from "../src/agent/context/resourceContextPlan";
import { AGENT_PERSONA_INSTRUCTIONS } from "../src/agent/model/agentPersona";
import {
  buildGenericSourceQuoteCitationGuidance,
  buildPaperQuoteCitationGuidance,
} from "../src/modules/contextPanel/paperAttribution";
import { BALANCED_EVIDENCE_GUIDANCE } from "../src/shared/quoteGuidance";
import type { AgentRuntimeRequest } from "../src/agent/types";
import type { PaperContextRef } from "../src/shared/types";

const BALANCED_EVIDENCE_PHRASES = [
  "important paper-specific claims checkable",
  "not to decorate every paragraph",
  "repetitive citations or low-information quotes",
];

const DIRECT_QUOTE_SAFETY_PHRASES = [
  "Direct quote text must be copied verbatim in the original source language",
  "[[source=...]]",
  "section=...",
  "chunk=...",
];

function assertBalancedEvidenceGuidance(text: string): void {
  const normalized = text.replace(/\s+/g, " ");
  for (const phrase of BALANCED_EVIDENCE_PHRASES) {
    assert.include(normalized, phrase);
  }
}

function assertDirectQuoteSafety(text: string): void {
  const normalized = text.replace(/\s+/g, " ");
  for (const phrase of DIRECT_QUOTE_SAFETY_PHRASES) {
    assert.include(normalized, phrase);
  }
}

function paper(): PaperContextRef {
  return {
    itemId: 11,
    contextItemId: 12,
    title: "Prompt Paper",
    firstCreator: "Smith",
    year: "2024",
  };
}

function request(): AgentRuntimeRequest {
  const paperContext = paper();
  return {
    conversationKey: 909,
    mode: "agent",
    userText: "Explain the method.",
    activeItemId: paperContext.itemId,
    libraryID: 1,
    selectedPaperContexts: [paperContext],
  };
}

function readSkill(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("quote guidance prompts", function () {
  afterEach(function () {
    clearAgentEvidenceCache();
  });

  it("centralizes the balanced evidence wording for runtime prompts", function () {
    assertBalancedEvidenceGuidance(BALANCED_EVIDENCE_GUIDANCE);
  });

  it("includes balanced evidence guidance in the core agent persona", function () {
    const text = AGENT_PERSONA_INSTRUCTIONS.join("\n");
    assert.include(text, BALANCED_EVIDENCE_GUIDANCE);
    assertDirectQuoteSafety(text);
  });

  it("includes balanced evidence guidance in Codex native MCP instructions", function () {
    const manifest = buildZoteroEnvironmentManifest({
      scope: {
        conversationKey: 1,
        libraryID: 1,
        kind: "paper",
        paperItemID: 11,
        activeItemId: 11,
        activeContextItemId: 12,
        paperTitle: "Prompt Paper",
      },
      mcpEnabled: true,
      mcpReady: true,
    });

    assertBalancedEvidenceGuidance(manifest);
    assertDirectQuoteSafety(manifest);
  });

  it("includes balanced evidence guidance in stable resource context", function () {
    const text = buildAgentStableResourceContextBlock(request());
    assertBalancedEvidenceGuidance(text);
    assertDirectQuoteSafety(text);
  });

  it("includes balanced evidence guidance in paper and source quote helpers", function () {
    const paperGuidance = buildPaperQuoteCitationGuidance(paper()).join("\n");
    const genericGuidance = buildGenericSourceQuoteCitationGuidance().join("\n");

    assertBalancedEvidenceGuidance(paperGuidance);
    assertDirectQuoteSafety(paperGuidance);
    assertBalancedEvidenceGuidance(genericGuidance);
    assertDirectQuoteSafety(genericGuidance);
  });

  it("includes balanced evidence guidance in preserved evidence context", async function () {
    const req = request();
    await commitAgentCacheEvidenceActivities({
      conversationKey: req.conversationKey,
      activities: [
        {
          toolName: "paper_read",
          toolLabel: "Read Paper",
          input: { mode: "targeted", query: "method" },
          content: {
            papers: [
              {
                paperContext: paper(),
                sourceKind: "paper_text",
                passages: [
                  {
                    text: "The method used a controlled task.",
                    sourceLabel: "(Smith, 2024)",
                  },
                ],
              },
            ],
          },
          request: req,
          timestamp: 1,
        },
      ],
    });

    const text = buildAgentEvidenceContextBlock({
      conversationKey: req.conversationKey,
      request: req,
    });

    assertBalancedEvidenceGuidance(text);
    assertDirectQuoteSafety(text);
  });

  it("keeps static skill prompts aligned with balanced evidence guidance", function () {
    const skills = [
      "../src/agent/skills/simple-paper-qa.md",
      "../src/agent/skills/compare-papers.md",
      "../src/agent/skills/evidence-based-qa.md",
      "../src/agent/skills/literature-review.md",
    ];

    for (const skill of skills) {
      const text = readSkill(skill);
      assertBalancedEvidenceGuidance(text);
      assertDirectQuoteSafety(text);
    }
  });
});
