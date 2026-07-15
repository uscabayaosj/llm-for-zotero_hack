import { assert } from "chai";
import {
  FullReadTargetResolutionError,
  resolveFullReadPaperTargets,
} from "../src/shared/fullReadTargetResolver";
import type { PaperContextRef } from "../src/shared/types";

const papers: PaperContextRef[] = [
  {
    itemId: 1,
    contextItemId: 11,
    title: "Representational Drift in Visual Cortex",
    firstCreator: "Smith et al.",
    year: "2023",
    citationKey: "smithDrift2023",
  },
  {
    itemId: 2,
    contextItemId: 22,
    title: "Auditory Learning Across Sessions",
    firstCreator: "Lee",
    year: "2024",
    citationKey: "leeAuditory2024",
  },
];

describe("fullReadTargetResolver", function () {
  it("keeps an untargeted full-read command on the active paper", function () {
    const result = resolveFullReadPaperTargets({
      question: "Read the full text before answering.",
      availablePapers: papers,
      selectedPapers: papers,
      activePaper: papers[0],
    });

    assert.equal(result.reason, "active-default");
    assert.deepEqual(result.papers, [papers[0]]);

    const incidentalMetadata = resolveFullReadPaperTargets({
      question:
        "Read the full text and explain how its result differs from Lee 2024.",
      availablePapers: papers,
      selectedPapers: papers,
      activePaper: papers[0],
    });
    assert.deepEqual(incidentalMetadata.papers, [papers[0]]);

    const incidentalExactTitle = resolveFullReadPaperTargets({
      question:
        "Read the full text and compare it with Auditory Learning Across Sessions.",
      availablePapers: papers,
      selectedPapers: papers,
      activePaper: papers[0],
    });
    assert.deepEqual(incidentalExactTitle.papers, [papers[0]]);

    const explicitCurrentPaper = resolveFullReadPaperTargets({
      question:
        "Read the full text of this paper and compare it with Auditory Learning Across Sessions.",
      availablePapers: papers,
      selectedPapers: papers,
      activePaper: papers[0],
    });
    assert.deepEqual(explicitCurrentPaper.papers, [papers[0]]);

    for (const question of [
      "Read the full text of this paper before answering.",
      "Read the full text of this paper; explain the result.",
      "Read the full text of this paper, focusing on auditory learning.",
      "Read the full text of the current paper. Use Lee 2024 only for comparison.",
      "请阅读这篇论文的完整内容。",
    ]) {
      const deictic = resolveFullReadPaperTargets({
        question,
        availablePapers: papers,
        selectedPapers: papers,
        activePaper: papers[0],
      });
      assert.deepEqual(deictic.papers, [papers[0]], question);
    }
  });

  it("preserves selected-paper order for ordinal references", function () {
    const result = resolveFullReadPaperTargets({
      question: "Read the complete second selected paper.",
      availablePapers: papers,
      selectedPapers: [papers[0], papers[1]],
      activePaper: papers[0],
    });

    assert.equal(result.reason, "ordinal");
    assert.deepEqual(result.papers, [papers[1]]);

    const alternateGrammar = resolveFullReadPaperTargets({
      question: "Read the second of the selected papers in full.",
      availablePapers: papers,
      selectedPapers: [papers[0], papers[1]],
      activePaper: papers[0],
    });
    assert.deepEqual(alternateGrammar.papers, [papers[1]]);

    const third: PaperContextRef = {
      itemId: 3,
      contextItemId: 33,
      title: "Third Selected Paper",
    };
    const coordinatedOrdinals = resolveFullReadPaperTargets({
      question: "Read the first and second selected papers in full.",
      availablePapers: [...papers, third],
      selectedPapers: [...papers, third],
      activePaper: third,
    });
    assert.equal(coordinatedOrdinals.reason, "ordinal");
    assert.deepEqual(coordinatedOrdinals.papers, papers);

    const ordinalList = resolveFullReadPaperTargets({
      question: "Read the first, second, and third selected papers in full.",
      availablePapers: [...papers, third],
      selectedPapers: [...papers, third],
      activePaper: third,
    });
    assert.deepEqual(ordinalList.papers, [...papers, third]);

    const fourth: PaperContextRef = {
      itemId: 4,
      contextItemId: 44,
      title: "Fourth Selected Paper",
    };
    const selected = [...papers, third, fourth];
    for (const question of [
      "Read the first two selected papers in full.",
      "Read selected papers 1 and 2 in full.",
    ]) {
      assert.deepEqual(
        resolveFullReadPaperTargets({
          question,
          availablePapers: selected,
          selectedPapers: selected,
          activePaper: fourth,
        }).papers,
        papers,
        question,
      );
    }
    assert.deepEqual(
      resolveFullReadPaperTargets({
        question: "Read the last two selected papers in full.",
        availablePapers: selected,
        selectedPapers: selected,
        activePaper: papers[0],
      }).papers,
      [third, fourth],
    );

    const chineseOrdinal = resolveFullReadPaperTargets({
      question: "请完整阅读第二篇已选论文。",
      availablePapers: papers,
      selectedPapers: [papers[0], papers[1]],
      activePaper: papers[0],
    });
    assert.deepEqual(chineseOrdinal.papers, [papers[1]]);

    for (const question of [
      "選択した2番目の論文を全文読む。",
      "선택한 두 번째 논문의 전문을 읽어 주세요.",
    ]) {
      const multilingualOrdinal = resolveFullReadPaperTargets({
        question,
        availablePapers: papers,
        selectedPapers: [papers[0], papers[1]],
        activePaper: papers[0],
      });
      assert.deepEqual(multilingualOrdinal.papers, [papers[1]], question);
    }
  });

  it("binds target parsing to the affirmative full-read clause", function () {
    for (const question of [
      "Do not read all papers. Read the Lee paper in full.",
      "You do not need all papers; read Lee completely.",
      "Do not read the current paper in full. Read the Lee paper completely.",
    ]) {
      const result = resolveFullReadPaperTargets({
        question,
        availablePapers: papers,
        selectedPapers: papers,
        activePaper: papers[0],
      });
      assert.deepEqual(result.papers, [papers[1]], question);
    }

    const first = resolveFullReadPaperTargets({
      question:
        "Compare with the second selected paper, but read the first selected paper completely.",
      availablePapers: papers,
      selectedPapers: papers,
      activePaper: papers[1],
    });
    assert.deepEqual(first.papers, [papers[0]]);

    assert.throws(
      () =>
        resolveFullReadPaperTargets({
          question: "Do not read the full paper.",
          availablePapers: papers,
          selectedPapers: papers,
          activePaper: papers[0],
        }),
      FullReadTargetResolutionError,
      "No affirmative full-read command",
    );

    for (const question of [
      "Rather than read the full paper, summarize the abstract.",
      "Do anything but read the full paper.",
      "Read anything except the full paper.",
      "不需要阅读全文。",
      "无须阅读全文。",
      "没必要通读整篇论文。",
      "이 논문 전체를 읽으면 안 됩니다.",
      "이 논문 전체를 읽을 필요가 없습니다.",
      "この論文の全文を読むな。",
      "この論文の全文を読む必要はありません。",
      "全文を読むのは避けてください。",
      "全文を読まずに要約してください。",
      "이 논문 전문을 읽는 것은 피하세요.",
      "我没有必要阅读全文，只要摘要。",
      "我不想阅读全文，只要摘要。",
      "不能通读整篇论文，只看摘要。",
      "전문을 읽을 필요가 전혀 없습니다.",
      "전문을 읽어선 안 돼요.",
      "전문을 읽고 싶지 않습니다.",
      "この論文の全文を読んではいけません。",
      "この論文の全文を読むべきではありません。",
      "全文を読んでほしくない。",
    ]) {
      assert.throws(
        () =>
          resolveFullReadPaperTargets({
            question,
            availablePapers: papers,
            selectedPapers: papers,
            activePaper: papers[0],
          }),
        FullReadTargetResolutionError,
        "No affirmative full-read command",
        question,
      );
    }

    for (const question of [
      "不要通读第一篇论文。请通读第二篇论文。",
      "不要通读第一篇论文，但请通读第二篇论文。",
      "不要从头到尾阅读第一篇论文，但要从头到尾阅读第二篇论文。",
      "最初の論文の全文は読んではいけません。しかし、選択した2番目の論文を全文読んでください。",
    ]) {
      assert.deepEqual(
        resolveFullReadPaperTargets({
          question,
          availablePapers: papers,
          selectedPapers: papers,
          activePaper: papers[0],
        }).papers,
        [papers[1]],
        question,
      );
    }

    for (const question of [
      "请勿从头到尾阅读这篇论文。",
      "别通读整篇论文。",
      "이 논문을 전문으로 읽지 말고 초록만 요약해 주세요.",
    ]) {
      assert.throws(
        () =>
          resolveFullReadPaperTargets({
            question,
            availablePapers: papers,
            selectedPapers: papers,
            activePaper: papers[0],
          }),
        FullReadTargetResolutionError,
        "No affirmative full-read command",
        question,
      );
    }
  });

  it("resolves author, citation-key, year, and partial-title references", function () {
    for (const question of [
      "Read the entire Lee paper.",
      "Read the complete @leeAuditory2024 paper.",
      "Read the entire 2024 paper.",
      "Read the complete Auditory Learning paper.",
      "Read Lee's entire paper.",
    ]) {
      const result = resolveFullReadPaperTargets({
        question,
        availablePapers: papers,
        selectedPapers: papers,
        activePaper: papers[0],
      });
      assert.deepEqual(result.papers, [papers[1]], question);
    }
  });

  it("returns all selected papers in their selection order", function () {
    for (const question of [
      "Read the full text of all selected papers.",
      "Read the full text of all the selected papers.",
      "Read the full text of all of the selected papers.",
      "Read all my selected papers in full.",
      "Read all of my selected papers in full.",
      "Read each selected paper from start to finish.",
      "Read both selected papers cover to cover.",
      "Read both of my selected papers cover to cover.",
      "Read the full text of the selected papers.",
      "Read my selected papers in full.",
      "Read the selected papers completely.",
      "请完整阅读所有已选的论文。",
      "選択したすべての論文を全文読む。",
      "선택한 모든 논문을 전문으로 읽어 주세요.",
    ]) {
      const result = resolveFullReadPaperTargets({
        question,
        availablePapers: papers,
        selectedPapers: [papers[1], papers[0]],
        activePaper: papers[0],
      });

      assert.equal(result.reason, "all-selected", question);
      assert.deepEqual(result.papers, [papers[1], papers[0]], question);
    }
  });

  it("does not reinterpret both as every selected paper", function () {
    const third: PaperContextRef = {
      itemId: 3,
      contextItemId: 33,
      title: "Third Selected Paper",
    };
    assert.throws(
      () =>
        resolveFullReadPaperTargets({
          question: "Read both selected papers cover to cover.",
          availablePapers: [...papers, third],
          selectedPapers: [...papers, third],
          activePaper: papers[0],
        }),
      FullReadTargetResolutionError,
      "but 3 papers are selected",
    );
  });

  it("distinguishes all selected papers from all available papers", function () {
    assert.throws(
      () =>
        resolveFullReadPaperTargets({
          question: "Read the full text of all selected papers.",
          availablePapers: papers,
          selectedPapers: [],
          activePaper: papers[0],
        }),
      FullReadTargetResolutionError,
      "no papers are selected",
    );

    const result = resolveFullReadPaperTargets({
      question: "Read the full text of all papers.",
      availablePapers: papers,
      selectedPapers: [papers[1]],
      activePaper: papers[1],
    });

    assert.equal(result.reason, "all-available");
    assert.deepEqual(result.papers, papers);

    const explicitlyAvailable = resolveFullReadPaperTargets({
      question: "Read the full text of all available papers.",
      availablePapers: papers,
      selectedPapers: [papers[1]],
      activePaper: papers[1],
    });
    assert.equal(explicitlyAvailable.reason, "all-available");
    assert.deepEqual(explicitlyAvailable.papers, papers);
  });

  it("uses a singular selected-paper selector only when it is unambiguous", function () {
    const selected = resolveFullReadPaperTargets({
      question: "Read the whole selected paper.",
      availablePapers: papers,
      selectedPapers: [papers[1]],
      activePaper: papers[0],
    });
    assert.deepEqual(selected.papers, [papers[1]]);

    assert.throws(
      () =>
        resolveFullReadPaperTargets({
          question: "Read the whole selected paper.",
          availablePapers: papers,
          selectedPapers: papers,
          activePaper: papers[0],
        }),
      FullReadTargetResolutionError,
      "ambiguous",
    );
  });

  it("rejects qualified all-paper scopes instead of silently over-reading", function () {
    for (const question of [
      "Read every paper by Smith completely.",
      "Read every selected paper from 2024 completely.",
      "Read every selected paper except the first completely.",
      "Read every paper about auditory learning completely.",
      "Read all papers on representational drift in full.",
    ]) {
      assert.throws(
        () =>
          resolveFullReadPaperTargets({
            question,
            availablePapers: papers,
            selectedPapers: papers,
            activePaper: papers[0],
          }),
        FullReadTargetResolutionError,
        "qualified",
      );
    }
  });

  it("rejects untargeted multi-paper reads when no active paper exists", function () {
    assert.throws(
      () =>
        resolveFullReadPaperTargets({
          question: "Read the full paper.",
          availablePapers: papers,
          selectedPapers: papers,
          activePaper: null,
        }),
      FullReadTargetResolutionError,
      "ambiguous",
    );
  });

  it("resolves explicitly named multi-paper requests", function () {
    const third: PaperContextRef = {
      itemId: 3,
      contextItemId: 33,
      title: "Unrelated Active Paper",
      firstCreator: "Ng",
    };
    const available = [third, papers[1], papers[0]];
    for (const question of [
      "Read the Smith and Lee papers in full.",
      "Read the Smith paper in full and the Lee paper in full.",
      "Read the Smith paper and the Lee paper in full.",
      "Read both the Smith and Lee papers in full.",
    ]) {
      const result = resolveFullReadPaperTargets({
        question,
        availablePapers: available,
        selectedPapers: available,
        activePaper: third,
      });
      assert.deepEqual(result.papers, papers, question);
    }

    const selectedSubset = resolveFullReadPaperTargets({
      question: "Read Smith and Lee selected papers in full.",
      availablePapers: available,
      selectedPapers: available,
      activePaper: third,
    });
    assert.deepEqual(selectedSubset.papers, papers);
  });

  it("rejects under-specified selected-paper subsets", function () {
    const third: PaperContextRef = {
      itemId: 3,
      contextItemId: 33,
      title: "Third Selected Paper",
    };
    for (const question of [
      "Read two selected papers in full.",
      "Read some selected papers in full.",
    ]) {
      assert.throws(
        () =>
          resolveFullReadPaperTargets({
            question,
            availablePapers: [...papers, third],
            selectedPapers: [...papers, third],
            activePaper: papers[0],
          }),
        FullReadTargetResolutionError,
        "qualified",
        question,
      );
    }
  });

  it("unions multiple affirmative full-read commands in command order", function () {
    const third: PaperContextRef = {
      itemId: 3,
      contextItemId: 33,
      title: "Unrelated Active Paper",
      firstCreator: "Ng",
    };
    for (const question of [
      "Read the Smith paper in full. Read the Lee paper in full.",
      "Read the Smith paper in full and read the Lee paper completely.",
    ]) {
      const result = resolveFullReadPaperTargets({
        question,
        availablePapers: [...papers, third],
        selectedPapers: [...papers, third],
        activePaper: third,
      });
      assert.equal(result.reason, "compound", question);
      assert.deepEqual(result.papers, papers, question);
    }
  });

  it("keeps downstream answer instructions out of all-paper qualifiers", function () {
    for (const question of [
      "Read all papers in full and answer with citations.",
      "Read all papers in full and focus on methods.",
      "Read all papers in full and quote from each.",
      "Read all selected papers in full while focusing on methods.",
      "Read all selected papers in full, focusing on methods.",
      "Read all selected papers in full with special attention to methods.",
    ]) {
      const result = resolveFullReadPaperTargets({
        question,
        availablePapers: papers,
        selectedPapers: papers,
        activePaper: papers[0],
      });
      assert.equal(
        result.reason,
        question.includes("selected") ? "all-selected" : "all-available",
        question,
      );
      assert.deepEqual(result.papers, papers, question);
    }
  });

  it("rejects selected-paper ordinals when nothing is selected", function () {
    assert.throws(
      () =>
        resolveFullReadPaperTargets({
          question: "Read the complete second selected paper.",
          availablePapers: papers,
          selectedPapers: [],
          activePaper: papers[0],
        }),
      FullReadTargetResolutionError,
      "no papers are selected",
    );
  });

  it("prefers the longest exact title instead of also selecting its prefix", function () {
    const shortTitle: PaperContextRef = {
      itemId: 3,
      contextItemId: 33,
      title: "Auditory Learning",
    };
    const result = resolveFullReadPaperTargets({
      question: "Read the complete Auditory Learning Across Sessions paper.",
      availablePapers: [shortTitle, papers[1]],
      selectedPapers: [shortTitle, papers[1]],
      activePaper: shortTitle,
    });

    assert.deepEqual(result.papers, [papers[1]]);

    const withArticle: PaperContextRef = {
      itemId: 4,
      contextItemId: 44,
      title: "The Auditory Study",
    };
    const withoutArticle: PaperContextRef = {
      itemId: 5,
      contextItemId: 55,
      title: "Auditory Study",
    };
    const articleResult = resolveFullReadPaperTargets({
      question: "Read the entire The Auditory Study paper.",
      availablePapers: [withoutArticle, withArticle],
      selectedPapers: [withoutArticle, withArticle],
      activePaper: withoutArticle,
    });
    assert.deepEqual(articleResult.papers, [withArticle]);
  });

  it("rejects out-of-range and unresolved explicit references", function () {
    assert.throws(
      () =>
        resolveFullReadPaperTargets({
          question: "Read the complete third selected paper.",
          availablePapers: papers,
          selectedPapers: papers,
          activePaper: papers[0],
        }),
      FullReadTargetResolutionError,
      "out of range",
    );
    assert.throws(
      () =>
        resolveFullReadPaperTargets({
          question: "Read the entire Miller paper.",
          availablePapers: papers,
          selectedPapers: papers,
          activePaper: papers[0],
        }),
      FullReadTargetResolutionError,
      "could not be resolved",
    );
    assert.throws(
      () =>
        resolveFullReadPaperTargets({
          question: "Read the Miller paper in full.",
          availablePapers: papers,
          selectedPapers: papers,
          activePaper: papers[0],
        }),
      FullReadTargetResolutionError,
      "could not be resolved",
    );
  });

  it("rejects ambiguous metadata references instead of using the active paper", function () {
    const ambiguous = [
      papers[0],
      {
        ...papers[1],
        firstCreator: "Smith",
      },
    ];
    assert.throws(
      () =>
        resolveFullReadPaperTargets({
          question: "Read the entire Smith paper.",
          availablePapers: ambiguous,
          selectedPapers: ambiguous,
          activePaper: ambiguous[0],
        }),
      FullReadTargetResolutionError,
      "ambiguous",
    );
  });

  it("rejects conflicting explicit metadata instead of choosing one field", function () {
    for (const question of [
      "Read the entire Smith 2024 paper.",
      "Read the complete Auditory Learning Across Sessions 2023 paper.",
    ]) {
      assert.throws(
        () =>
          resolveFullReadPaperTargets({
            question,
            availablePapers: papers,
            selectedPapers: papers,
            activePaper: papers[0],
          }),
        FullReadTargetResolutionError,
        "conflicting",
      );
    }
  });

  it("validates ordinal metadata qualifiers instead of ignoring conflicts", function () {
    for (const question of [
      "Read the first selected paper by Lee in full.",
      "Read the second selected paper by Smith in full.",
      "Read the first selected paper from 2024 in full.",
    ]) {
      assert.throws(
        () =>
          resolveFullReadPaperTargets({
            question,
            availablePapers: papers,
            selectedPapers: papers,
            activePaper: papers[0],
          }),
        FullReadTargetResolutionError,
        "conflicts",
      );
    }
  });

  it("uses the primary surname from multi-creator display text", function () {
    const multiCreator = {
      ...papers[0],
      firstCreator: "Smith and Jones",
    };
    const result = resolveFullReadPaperTargets({
      question: "Read the entire Smith paper.",
      availablePapers: [multiCreator, papers[1]],
      selectedPapers: [multiCreator, papers[1]],
      activePaper: papers[1],
    });
    assert.deepEqual(result.papers, [multiCreator]);
  });

  it("does not reinterpret a year inside an exact title as publication metadata", function () {
    const titledYear: PaperContextRef = {
      itemId: 5,
      contextItemId: 55,
      title: "Auditory Learning 2024 Benchmark",
      firstCreator: "Ng",
      year: "2023",
    };
    const result = resolveFullReadPaperTargets({
      question: "Read the complete Auditory Learning 2024 Benchmark paper.",
      availablePapers: [...papers, titledYear],
      selectedPapers: [...papers, titledYear],
      activePaper: papers[0],
    });

    assert.deepEqual(result.papers, [titledYear]);
  });

  it("supports short surnames and named CJK titles", function () {
    const liPaper: PaperContextRef = {
      itemId: 3,
      contextItemId: 33,
      title: "Neural Coding",
      firstCreator: "Li",
      year: "2022",
    };
    const cjkPaper: PaperContextRef = {
      itemId: 4,
      contextItemId: 44,
      title: "听觉学习",
      firstCreator: "王",
      year: "2021",
    };
    const available = [...papers, liPaper, cjkPaper];

    assert.deepEqual(
      resolveFullReadPaperTargets({
        question: "Read the entire Li paper.",
        availablePapers: available,
        selectedPapers: available,
        activePaper: papers[0],
      }).papers,
      [liPaper],
    );
    assert.deepEqual(
      resolveFullReadPaperTargets({
        question: "请完整阅读听觉学习论文。",
        availablePapers: available,
        selectedPapers: available,
        activePaper: papers[0],
      }).papers,
      [cjkPaper],
    );
    for (const question of [
      "请完整阅读王的论文。",
      "请完整阅读听觉学习这篇论文。",
      "请阅读听觉学习论文的完整内容。",
    ]) {
      assert.deepEqual(
        resolveFullReadPaperTargets({
          question,
          availablePapers: available,
          selectedPapers: available,
          activePaper: papers[0],
        }).papers,
        [cjkPaper],
        question,
      );
    }
  });
});
