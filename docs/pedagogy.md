# Pedagogy: what the evidence supports

How the CAIRN verbs map to learning research, what that implies for the design, and what is deliberately left out. This is a design rationale, not a literature review: where a claim rests on a source I checked, it links to it; the rest is marked.

## Bottom line

- **Recall** (explaining without notes) is the best-supported element. **Inspect** (reading alone) is the weakest.
- The biggest gap is **spacing**. Distributed practice is one of two techniques rated "high utility" by Dunlosky et al. (2013). Cairn v1 does not schedule reviews; it records when each mode was completed so that can be added later.
- Personalize by **prior knowledge and goals**, not by "learning style".

## By element

| Element | Evidence | Verdict | In cairn |
|---|---|---|---|
| **Choose** (goals) | Learner control helps motivation and experienced learners, but novices often choose poorly, and guidance that helps novices can hurt experts (the expertise reversal effect; Kalyuga 2007, Kirschner & van Merriënboer 2013). | Mixed | *Recommended* is the default view. Goals always show prerequisites. "I already know this" lets a learner test out of a prerequisite after facing its recall prompt. |
| **Act** (do) | Active learning beats passive. For programming, Predict → Run → Investigate → Modify → Make is an established structure ([PRIMM, Sentance et al. 2019](https://eprints.gla.ac.uk/229013)). Copy-paste commands invite mindless execution. | Strong, if not copy-paste | Steps can carry a `predict` line. Do-tasks can end with a `modify` challenge. |
| **Inspect** (read) | Rereading and highlighting are low utility ([Dunlosky et al. 2013](https://stafforini.com/works/dunlosky-2013-improving-students-learning/)). Prequestions help for the content they target (reported g ≈ 0.54) but barely transfer to other content (g ≈ 0.04), per a [preregistered meta-analysis](https://ifp.nyu.edu/2025/journal-article-abstracts/s10648-025-10075-7/) *(citation to be confirmed)*. Self-explanation prompts while studying: g ≈ 0.55 ([Bisra et al. 2018](https://www.clearinghouse.edu.tum.de/wp-content/uploads/2023/09/CHU-KR-25_ENG_Bisra_2018_Selbsterklaerungen.pdf)). | Weak alone, good with prompts | `predict` prompts aim at the key idea of a reading. `elaborate` asks "why does this work?" while reading. |
| **Recall** (explain) | Practice testing is high utility (Dunlosky et al. 2013; Roediger & Karpicke 2006). Explaining and teaching help (Fiorella & Mayer 2013). A single checkbox invites the fluency illusion. | Strongest | The `explain` prompt, a link back to the source to check against, and per-checkbox completion times. |
| **Note** | Generative notes in your own words help; verbatim notes do not (Fiorella & Mayer 2016). | Good, if generative | Prompted fields ("In my words", "What surprised me", "Open question") instead of a blank box. |

## Deliberately left out

- **Interleaving**: mixed evidence outside discriminating similar categories (Brunmair & Richter 2019). Goal routes mix topics naturally anyway.
- **Learning styles**: no evidence that matching instruction to a preferred modality helps (Pashler et al. 2008).
- **Forced spaced repetition**: valuable, but a scheduler adds complexity and pressure. Completion timestamps are kept so it can be added.

## Writing tasks with this in mind

- Put the question before the material (`predict`), and keep it about the key idea.
- Prefer "change it and see" over "run these exact commands" for people who already know the basics.
- Every `explain` prompt should be answerable without the source open, and checkable against it afterwards. Hidden answers support this: attempt first, then get corrective feedback.
- Size tasks to 5–60 minutes. Several short sessions beat one marathon.

## Personalization

Shape the *content mix* by what the learner already knows and wants to be able to do: skip or compress known basics, favor modify/debug/trace tasks for experienced learners, set session length. Do not adapt by modality preference. A personal profile (see the skill) records these choices outside the repo.

## Sources

- Checked this session: Dunlosky et al. 2013 (summary), Bisra et al. 2018, Sentance et al. 2019 (PRIMM), Kalyuga 2007 (search result), the prequestion meta-analysis (summary only).
- Cited from memory, verify before relying on them: Roediger & Karpicke 2006; Fiorella & Mayer 2013, 2016; Kirschner & van Merriënboer 2013; Brunmair & Richter 2019; Pashler et al. 2008.
- Idea borrowed from [DrCatHicks/learning-opportunities](https://github.com/DrCatHicks/learning-opportunities): prediction before observation, and retrieval-based exercises, applied here to a static plan rather than in-session coaching.
