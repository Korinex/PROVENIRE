<p align="center">
<strong>PROVENIRE</strong>  

  <em>Signed, reviewable custody handoffs for pharmaceutical batches</em>
</p> <p align="center">
  <img alt="Hackathon prototype" src="https://img.shields.io/badge/status-hackathon%20prototype-167D8D" />
  <img alt="Pharmaceutical supply-chain traceability" src="https://img.shields.io/badge/domain-pharma%20traceability-315B7D" />
  <img alt="Claims and limitations documented" src="https://img.shields.io/badge/design-evidence%20first-3A795B" />
</p>

> **Provenire turns a pharmaceutical handoff from a sender-only status update into a two-party, signed, reviewable custody event.** The sender records what they dispatched; the receiver records what they observed. If the claims disagree, the discrepancy remains visible for review.

---

## 🧾 Project & competition details

| Field | Details |
| --- | --- |
| **Prototype name** | **Provenire** |
| **Event** | Hackathon 2026  |
| **Institution** | Priyadarshini College  |
| **Problem statement title** | **Trust Gaps in Supply Chain Traceability** |
| **Problem statement number** | **PS 1** |
| **Team name** | **ZENITH** |
| **Team leader** | **Shifa Akbani** |
| **Team members** | **Khudaija Harmain, Jeeya Chavan, Khushi Jaiswal** |


## 🎯 The problem

Pharmaceutical products move through manufacturers, distributors, warehouses, hospitals, and pharmacies. Each organization may hold only part of the shipment history. A sender’s dispatch record does not, by itself, establish what the receiver observed or accepted. If records are disconnected or a later status overwrites an earlier claim, a quantity discrepancy can be difficult to investigate.

The supplied problem statement asks for a traceability system that records origin and movement across multiple parties and strengthens transparency and tamper resistance without depending on a single centralized authority. Existing regulation and standards already address important parts of traceability: the U.S. FDA describes DSCSA requirements for interoperable electronic tracing of certain prescription drugs, while GS1 EPCIS provides a standard way to share supply-chain event information.[1][2]

**Provenire’s focused response:** make the receiving party’s observation a separate, attributable claim and keep a disagreement visible instead of silently treating dispatch as successful receipt.

## 💡 What the prototype is designed to demonstrate

The hackathon prototype is scoped to one illustrative batch and a three-party route:

```
MedSure Labs → Central Pharma Distributor → Ramdeobaba Hospital Pharmacy
Batch: MS-2026-001 · Product: MedSure 500 mg · Initial quantity: 1,000 units
```

### The core handoff

1. **Create the batch:** the manufacturer records and signs an origin claim.

1. **Dispatch:** the sender signs a dispatch claim. The handoff becomes `receiver_pending`.

1. **Inspect:** the intended receiver reviews the preceding history and the sender’s claim.

1. **Record receipt:** the receiver submits one receipt operation stating the quantity observed.

1. **Derive the result:** the backend marks a matching receipt `accepted`; a mismatch creates a conflict and sets the handoff to `needs_review`.

1. **Preserve the evidence:** dispatch and receipt remain separate claims. Neither silently overwrites the other.

1. **Verify:** a privacy-limited public view reports record checks and relevant status without exposing the full commercial route.

### The discrepancy example

```
Sender’s dispatch claim:  1,000 units
Receiver’s observation:     950 units
Quantity variance:           50 units
Handoff state:          needs_review
Onward dispatch:         blocked
```

In a mismatch, the interface should show the **last uncontested custodian**, the receiver’s reported observation, and the quantity variance separately. The prototype does **not** implement a full inventory-allocation or batch-splitting model; it must not imply that the 950 observed units and 50-unit variance have been formally allocated as separate lots.

### Integrity and verification demonstrations

The planned demo also covers a changed signed field failing verification, a route with a missing expected handoff, and a verifier peer that is unavailable or disagrees. These states must not be shown as a clean, fully verified route.

> **Scope note:** This README describes the frozen prototype design and intended demo. It does not assert that each feature has been implemented or passed its acceptance tests. Update this statement with build evidence as the repository evolves.

## 🛠️ Prototype architecture

The project’s technical plan describes the following target stack and boundaries:[3]

| Layer | Planned prototype approach |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| API/backend | Node.js, TypeScript, Express |
| Persistence | SQLite for the local/logical-node prototype |
| Record integrity | Canonical JSON, SHA-256, predecessor links |
| Claim signatures | ECDSA P-256 using simulated organization identities |
| Verification | Central application write path plus replicated/logical verifier nodes |

### Important trust and architecture boundaries

- Organization-level signatures are **simulated** unless organizations have separately authenticated users and independently controlled keys. They do not prove that a particular employee authorized a signature.

- The prototype has a central application write path. Its verifier nodes demonstrate replicated validation; they are **not** independent organizational authorities, production consensus, Byzantine fault tolerance, or fully decentralized writes.

- A valid hash or signature shows integrity and attribution under the prototype’s trust model. It does **not** prove that the physical shipment, count, label, or medicine contents are genuine or correct.

- The project is not represented as FDA, CDSCO, EU, DSCSA, GS1, or EPCIS certified or compliant.

## 👥 Primary stakeholders

| Stakeholder | Role in the workflow | Potential value to validate |
| --- | --- | --- |
| **Manufacturers** | Create batch-origin and dispatch claims | More inspectable downstream handoff evidence; fewer disputes based only on sender records |
| **Distributors / logistics partners** | Review incoming history and attest to quantities observed | A clearer receiving workflow and a preserved record of shortages or mismatches |
| **Hospital and pharmacy receiving teams** | Confirm or flag the next handoff | Better visibility into prior custody claims and unresolved exceptions |
| **Quality, compliance, and audit teams** | Review claims, exceptions, and resolutions | Easier access to linked, attributable evidence—if data coverage and governance are adequate |
| **Network sponsor / consortium operator** | Potentially admit participants and coordinate shared infrastructure | A possible operating and funding role; no sponsor or partnership is established by the supplied materials |
| **Regulators and the public** | Potentially consult a limited verification result | A privacy-safe record-status view; not a substitute for regulator systems, laboratory testing, or inspection |

The daily users and the organization that would fund a real deployment may differ. A pilot must identify the budget owner, operating sponsor, and reason each supply-chain participant would join.

## 📈 Feasibility, viability & scalability

### Economic feasibility — plausible for a narrow prototype

The hackathon MVP is deliberately small: one fictional batch, a few participant roles, two handoffs, one discrepancy, and a bounded verification flow. Reusing the planned web stack and existing proof primitives is a reasonable way to keep prototype effort contained. For this scale, storing and hashing a small number of events is unlikely to be the main cost driver.

**Commercial economics are not yet established.** Likely material costs include partner onboarding, integration with existing systems, identity and key management, security, privacy controls, dispute governance, support, and ongoing operations. There are no validated implementation-cost estimates, savings figures, prices, or return-on-investment results in the supplied materials.

### Viability — a testable buyer hypothesis, not proven demand

A manufacturer, distributor group, hospital network, or supply-chain consortium might value Provenire if it measurably:

- reduces time spent reconciling sender and receiver records;

- helps assign and investigate quantity discrepancies earlier;

- increases the share of important handoffs with receiver-side evidence;

- improves access to audit or recall evidence without exposing unnecessary commercial data.

These are **hypotheses**, not demonstrated outcomes. No customer interviews, paid pilot, buyer commitment, willingness-to-pay evidence, or measured workflow savings were found in the project materials. The strongest next proof would be a pilot comparing baseline and Provenire-assisted investigation time, manual reconciliation steps, handoff evidence coverage, and partner onboarding effort.[4]

### Scalability — technically extendable, network scaling unproven

An event-oriented model of organizations, batches, dispatches, receipts, conflicts, and resolutions has a plausible path to more participants and transactions. That does not establish production scalability. The current logical-node design is a prototype, and scale will depend on:

- reliable identity admission, key custody, rotation, and revocation;

- integration with ERP, warehouse, serialization, and existing traceability systems;

- clear rules for missing handoffs, corrections, partial receipts, and disputes;

- partner incentives, data-sharing policies, privacy, and governance;

- uptime, monitoring, security testing, and support;

- interoperability with relevant identifiers, standards, and jurisdictional requirements.

The MediLedger pilot report itself describes participation, governance, interoperability, and adoption as practical challenges for shared traceability networks.[5] Provenire should therefore be presented as a focused prototype and pilot hypothesis—not a ready-made global network.

## ✅ Why might a stakeholder choose to buy or pilot it?

The strongest potential purchase case is **not “we use blockchain.”** It is that a participant may need less time and effort to answer questions such as:

- What did the sender say was dispatched?

- What did the receiver say was actually observed?

- Which party signed each statement?

- Is the handoff still pending, disputed, or resolved?

- Is the route history incomplete, or has a record failed integrity checks?

Provenire becomes compelling only if it can answer these questions more usefully or affordably than the current ERP/WMS, serialization, proof-of-delivery, exception-management, or manual process. Existing vendors already offer substantial traceability and exception capabilities, and MediLedger’s pilot already describes recipient acceptance before transfer completion.[5][6][7][8][9] Provenire must validate a concrete workflow advantage rather than claim the broad category as novel.

## ⚠️ Risks, challenges & planned mitigations

| Risk / challenge | Why it matters | Prototype response / next mitigation |
| --- | --- | --- |
| **🧪 Physical truth & identity** | Signatures do not prove a physical count, product contents, or that a named employee authorized a simulated organization key. | Label claims and keys as simulated; preserve both parties’ statements; require real-world testing, authenticated users, and managed keys for a pilot. |
| **🔗 Participation & buyer adoption** | Missing handoffs create blind spots, while users may resist extra steps and no buyer or ROI is validated yet. | Show incomplete coverage, interview receiving teams, identify a sponsor, and measure workflow outcomes before claiming demand. |
| **📦 Discrepancies & corrections** | One batch-level holder field cannot represent partial quantities; edits could hide the original dispute. | Set `needs_review`, block onward dispatch, show the last uncontested custodian and receiver observation separately, and append signed resolutions. |
| **🔒 Privacy & security** | Route, quantity, partner, or document data may be sensitive; exposed or compromised keys weaken trust. | Minimize the public projection, test for data leakage, keep keys out of the frontend/logs, and plan access controls and key revocation. |
| **🔌 Interoperability & regulation** | A proprietary event model can create another silo, and requirements vary by jurisdiction. | Design toward future EPCIS/GS1 mapping; do not claim compliance or certification without implementation and validation. |
| **🧭 Network & scaling claims** | A central write path and team-operated logical nodes are not independent authorities or production consensus. | Describe the architecture honestly; show agreement, disagreement, incomplete, or unavailable states; treat governance and integrations as pilot work. |
| **🏁 Competitive differentiation** | Existing platforms already provide traceability, exchange, verification, and exception workflows. | Position Provenire narrowly and prove a measurable workflow advantage against current systems before claiming uniqueness. |

## 🧪 Suggested pilot measures

A pilot should establish a baseline before claiming impact. Useful measures include:

- median time from a reported mismatch to an assigned investigation;

- time to identify affected batches and locations during a trace or recall exercise;

- manual reconciliation steps per discrepancy;

- percentage of expected handoffs with receiver-attested receipts;

- number and duration of unresolved quantity conflicts;

- time and effort required to onboard each participating organization;

- percentage of public-verifier responses that expose no restricted route or quantity data.

## 🗺️ Roadmap

### Hackathon prototype

- One fictional product and batch.

- Manufacturer → distributor → hospital-pharmacy route.

- Separate signed dispatch and receipt claims.

- Visible `receiver_pending` and `needs_review` states.

- Quantity mismatch, tamper-check, privacy-limited verification, and deterministic reset.

- Simulated organization signing and logical verifier-node behavior, clearly labelled.

### Pilot-stage investigation

- Interview actual receiving, quality, compliance, and logistics users.

- Confirm the buying sponsor and participant incentives.

- Test one real integration and one operational discrepancy workflow.

- Specify key management, governance, access control, retention, and dispute resolution.

- Measure outcomes against the existing process.

### Longer-term possibilities—not current capabilities

EPCIS 2.0 exchange, GS1 identifiers, ERP/WMS adapters, package-level serialization, split/merge and quantity allocation, offline capture, tamper-evident packaging, and sensor or laboratory evidence. Each requires separate implementation, validation, and governance.

## 🔬 Research notes & real-world context

### Comparable systems

- **TraceLink** documents U.S. DSCSA traceability capabilities, EPCIS exchange, verification, and partner exception workflows.[6][7]

- **Systech** announced TraceIQ as a traceability and operational-intelligence product with AI-assisted investigation claims. Those are vendor claims, not independently measured outcomes.[8]

- **MediLedger**’s FDA-hosted pilot report describes recipient acceptance before a custody transfer completes. It is a pilot report, not proof of broad commercial deployment or that Provenire’s precise workflow is unique.[5]

- **PharmaLedger/AstraTrace** publicly describes EPCIS-based supply-chain visibility, signature checks, and tamper-evident history. The public product materials reviewed do not establish whether every configuration signs a receiver’s exact physically observed quantity for each dispatch; absence of that detail is not proof the feature is unavailable.[9][10]

**Implication:** Provenire should not claim it invented traceability, recipient acceptance, signatures, or exception management. Its proposed distinction is the exact operational treatment of receiver-observed quantity, pending custody, and preserved mismatch evidence—and that distinction still needs competitor and user validation.

### Real-world case: contaminated paediatric medicines in The Gambia

CDC reported **78 clinically suspected acute kidney injury cases and 66 deaths** in the 2022 outbreak among children in The Gambia. Testing found four paediatric medicines containing unacceptable levels of diethylene glycol and ethylene glycol. WHO reported no further fatalities after the nationwide recall.[11][12][13]

**Important qualification:** the cited sources do **not** establish that a lack of digital traceability caused the outbreak. Investigators identified products, a stated manufacturer, and an import date. The case illustrates why quality testing, regulatory surveillance, authorized distribution, complete records, and rapid recall matter. A Provenire-like history could help investigators inspect declared handoffs and identify gaps **if participants record reliable events**; it cannot test chemical contents or prove an individual medicine is genuine.[11][12][13][14]

## 📚 References

1. U.S. Food and Drug Administration (FDA), [Drug Supply Chain Security Act (DSCSA)](https://www.fda.gov/drugs/drug-supply-chain-integrity/drug-supply-chain-security-act-dscsa).

1. GS1, [EPCIS and CBV standards](https://www.gs1.org/standards/epcis).

1. Provenire project technical requirements: [`02_PROVENIRE_TRD.md`](02_PROVENIRE_TRD.md), [`05_PROVENIRE_BACKEND_SCHEMA.md`](05_PROVENIRE_BACKEND_SCHEMA.md), and [`Provenire Final Freeze Decisions.md`](Provenire%20Final%20Freeze%20Decisions.md).

1. Provenire project strategic assessment: [`08_PROVENIRE_STRATEGIC_ASSESSMENT.md`](08_PROVENIRE_STRATEGIC_ASSESSMENT.md). This is an assessment of project materials, not customer-discovery evidence or a technical audit.

1. FDA-hosted, [MediLedger DSCSA Pilot Project Report](https://www.fda.gov/media/168283/download).

1. TraceLink, [U.S. DSCSA Compliance](https://www.tracelink.com/products/product-orchestration/country-compliance/us-compliance).

1. TraceLink OPUS, [DSCSA Exception Management](https://opus.tracelink.com/documentation/prod/en-US/poet/Content/top_nav/compliance_exception.htm).

1. Systech, [Systech Launches TraceIQ](https://www.systechone.com/systech-launches-traceiq-transforming-pharmaceutical-traceability-from-compliance-to-operational-intelligence/) (31 August 2026; vendor announcement).

1. PharmaLedger Association, [Platform](https://pharmaledger.org/platform).

1. PharmaLedger Association, [AstraTrace: Supply Chain Intelligence](https://pharmaledger.org/astratrace/supply-chain).

1. World Health Organization (WHO), [Medical Product Alert No. 6/2022: Substandard (contaminated) paediatric medicines]([https://www.who.int/news/item/05-10-2022-medical-product-alert-n-6-2022-substandard-(contaminated](https://www.who.int/news/item/05-10-2022-medical-product-alert-n-6-2022-substandard-(contaminated) )-paediatric-medicines).

1. U.S. Centers for Disease Control and Prevention (CDC), [Acute Kidney Injury Among Children Likely Associated with Diethylene Glycol–Contaminated Medications—The Gambia, June–September 2022](https://www.cdc.gov/mmwr/volumes/72/wr/mm7209a1.htm).

1. WHO, [WHO’s swift response saves lives, halting acute kidney injury outbreak in The Gambia](https://www.who.int/about/accountability/results/who-results-report-2020-mtr/country-story/2023/who-s-swift-response-saves-lives--halting-acute-kidney-injury-outbreak-in-the-gambia).

1. WHO, [WHO urges action to protect children from contaminated medicines](https://www.who.int/news/item/23-01-2023-who-urges-action-to-protect-children-from-contaminated-medicines).

1. U.S. FDA, [Historical information on counterfeit or unapproved prescription drugs, 2012–2014](https://www.fda.gov/drugs/drug-supply-chain-integrity/historical-information-fda-issues-letters-doctors-who-may-have-purchased-counterfeit-or-unapproved).

---

## 📌 Prototype disclaimer

Provenire is a hackathon-stage concept/prototype. It verifies aspects of submitted record integrity and organization-level claims under its configured trust model. It does **not** independently verify a medicine’s physical contents, prove chemical safety, guarantee that a participant told the truth, or establish regulatory compliance. Unless and until a working build and pilot evidence support stronger statements, describe capabilities as **prototype scope or intended behavior**, not validated production outcomes.

<p align="center"><sub>Provenire · Evidence-first pharmaceutical handoffs · Fictional demo data</sub></p>
