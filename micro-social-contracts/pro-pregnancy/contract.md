---
id: pro-pregnancy
title: Pro-Pregnancy Micro-Contract
version: 0.1.0
status: draft
aim: >
  Make pregnancy as comfortable as it can be and free of chronic negative
  consequences for the person who carries it, and in return define abortion
  as ending a pregnancy, never as killing the human life in the womb.

provides:
  - pregnancy-care                 # medical, comfort and mental-health care from confirmation to recovery
  - pregnancy-income-security      # income replacement and job protection during pregnancy and recovery
  - confidential-pregnancy         # housing away from home, confidential birth
  - guardianship-transfer          # handing over a newborn to guardianship, with release from parental duties
  - pregnancy-injury-care          # lifelong care and no-fault compensation for injuries caused by pregnancy
  - preterm-child-care             # care for children born by extraction at the threshold

requires: []                       # can stand alone; overlaps with a universal-healthcare contract if one is present

delegates:
  - capability: child-rearing-support
    note: Parental leave, child allowance and childcare for people who keep the child. This contract ends at recovery.
  - capability: child-welfare
    note: Long-term care of children not placed with a permanent family within one year. Budgeted here until another contract claims it.
  - capability: universal-healthcare
    note: If present, it supplies the general care this contract relies on, and this contract funds only the pregnancy-specific parts.

conflicts:
  - capability: abortion-on-request
    reason: Permits ending a pregnancy by an act whose effect is to kill the human life in the womb, which §5.1 excludes.

parameters:
  extraction_threshold_week:
    default: 28
    range: [22, 37]
    unit: completed gestational weeks
    meaning: >
      The earliest week at which the child counts as able to live on its own, so
      the pregnancy may be ended by extraction on request (§2.4). An earlier week
      shortens the pregnancy the person must carry. It also raises neonatal intensive
      care, mortality and lifelong impairment among the children extracted.
  pregnancy_leave_weeks:
    default: 6
    range: [0, 40]
    unit: weeks (average taken)
    meaning: Paid leave during pregnancy, taken whenever it is needed.
  recovery_leave_weeks:
    default: 16
    range: [6, 52]
    unit: weeks
    meaning: Paid recovery after the pregnancy ends, whether or not the person keeps the child.
  income_replacement:
    default: 1.0
    range: [0.5, 1.0]
    unit: share of prior earnings
    meaning: How much of prior earnings is paid during leave. People without earnings get a flat allowance.
  placement_window_months:
    default: 12
    unit: months
    meaning: The time within which guardianship aims to place a relinquished newborn with a permanent family.

funding:
  basis: levy
  note: >
    Paid by every citizen through a pregnancy levy. Adopters choose whether it is
    a flat amount per adult or a share of income. The explorer shows both
    per-resident and per-adult figures.
---

# Pro-Pregnancy Micro-Contract

*Draft 0.1. This text states the values of the people who want this contract. The catalogue does not endorse or amend them.*

## §1 Aim

1.1 Society carries the burdens of pregnancy together, so that no one who is pregnant carries them alone. Pregnancy should be as comfortable as care can make it, and it should leave no chronic negative consequence: physical, financial, social or legal.

1.2 In return, a pregnancy is never ended by killing the human life in the womb.

## §2 Definitions

2.1 **Pregnancy.** The condition of carrying human life in the womb, from conception until that life leaves the womb.

2.2 **Human life in the womb.** The human life form that a pregnancy carries, at every stage.

2.3 **Pregnant person.** Anyone who is pregnant. *(Drafting placeholder: adopters may choose the term they prefer.)*

2.4 **Abortion.** Ending a pregnancy. Under this contract, abortion happens only:
  - (a) by extracting the child from the womb once it can live on its own, meaning at or after the extraction threshold (§7); or
  - (b) by removing the human life in the womb after it has already died.

2.5 Abortion never overlaps with an act whose effect is to kill the human life in the womb. An act with that effect is not abortion under this contract.

2.6 **Extraction threshold.** The gestational week at which the child counts as able to live on its own (§7).

2.7 **Chronic negative consequence.** Any lasting harm that follows from a pregnancy: an injury, a loss of income or job, a lost home, stigma, or a parental duty the person did not choose to take on.

## §3 What society commits to

3.1 **Care in pregnancy.** Free prenatal care, including checkups, scans, tests, midwife and doula support, and treatment of complications.

3.2 **Comfort.** Treatment of nausea and hyperemesis, pain management, physiotherapy, mobility aids and help at home, all offered as standard care, not as extras.

3.3 **Mental health.** Perinatal mental-health care, available on request and without a waiting list.

3.4 **A navigator.** Each pregnant person gets one named navigator who coordinates the services in this contract, plus a phone line that answers 24 hours a day.

3.5 **Ending the pregnancy.** The pregnant person may choose:
  - (a) birth at term; or
  - (b) extraction on request at or after the extraction threshold, with the child going directly into neonatal care.

3.6 **Pregnancy loss.** When the human life in the womb has died, the pregnant person gets care to remove it, plus bereavement support.

3.7 **Recovery.** Twelve months of postpartum care, including pelvic-floor and abdominal rehabilitation and mental-health follow-up, whatever the outcome of the pregnancy.

3.8 **Income and work.** Paid pregnancy leave and paid recovery leave (§7). The person's job is protected, and employers must make the workplace accommodations they need.

3.9 **Housing and confidentiality.** A place in a maternity residence away from home on request, and the option of a confidential birth.

3.10 **Guardianship transfer.** A pregnant person who does not want to raise the child may hand it over to guardianship at birth or extraction. This releases them from every parental duty, carries no stigma, and ends any obligation to pay for the child. Guardianship aims to place the child with a permanent family within the placement window (§7).

3.11 **Lasting injury.** Lifelong care for injuries caused by the pregnancy, plus a no-fault compensation fund.

3.12 **Children born by extraction.** Neonatal intensive care, developmental follow-up, and lifelong support for any impairment that results from early extraction.

## §4 What citizens commit to

4.1 Every citizen pays the pregnancy levy (§6).

4.2 Employers protect the jobs of people who are pregnant or recovering, and make the accommodations they need.

4.3 No one discriminates against a person because they are pregnant, have been pregnant, or chose guardianship transfer.

4.4 No one performs, procures or assists an act whose effect is to kill the human life in the womb (§2.5).

## §5 Limits

5.1 No service in this contract includes an act whose effect is to kill the human life in the womb.

5.2 Nothing in this contract compels a person who keeps the child to accept any service. Every service is an entitlement, not a duty.

## §6 Funding

6.1 The costs of §3 are shared by all citizens through a pregnancy levy. The explorer (`explorer/index.html`) estimates the levy per resident and per adult from the parameters in §7.

6.2 Adopters choose whether the levy is a flat amount per adult or a share of income.

## §7 Parameters

Adopters set these values when they adopt the contract. The defaults and ranges are in the front matter.

| Parameter | Default | Unit |
|---|---|---|
| Extraction threshold | 28 | completed gestational weeks |
| Pregnancy leave | 6 | weeks (average taken) |
| Recovery leave | 16 | weeks |
| Income replacement | 100% | of prior earnings |
| Placement window | 12 | months |

## §8 Review and measures

The contract is reviewed every five years against these measures:

- maternal mortality and severe maternal morbidity
- how common pregnancy-caused chronic conditions are 1, 5 and 10 years after a pregnancy (pelvic-floor dysfunction, incontinence, chronic pain, depression)
- employment and income 1 and 5 years after a pregnancy, compared with people of the same age who were not pregnant
- survival and impairment of children born by extraction, reported by week of extraction
- the share of relinquished newborns placed with a permanent family within the placement window
- the levy per resident

## §9 Open questions for adopters

These are gaps in the draft. Only adopters can close them, and each one changes the text.

1. **Threats to the pregnant person's life before the threshold.** Examples include ectopic pregnancy, severe pre-eclampsia before viability, and infection of the womb. §2.4 covers extraction of a living child after the threshold and removal after death. It does not yet say what happens when the pregnant person's life is at risk before the threshold and the child cannot survive extraction.
2. **What "able to live on its own" means.** It could mean survival with intensive care, survival without it, or a probability cut-off. The threshold week in §7 puts one of these readings into practice. The explorer shows what each week means for survival, impairment and cost.
3. **Enforcement of §4.4.** The draft doesn't yet say whether breaches are civil, criminal or professional-conduct matters, or who is liable: the pregnant person, the provider or a third party.
4. **Pregnancy after assault.** Should the draft add anything beyond §3, such as priority confidentiality, longer leave, or specialised care?
5. **The other parent.** The draft doesn't yet assign any duties to the person who conceived the child with the pregnant person, whether financial or otherwise.
6. **Terminology.** Adopters may prefer another term to "pregnant person" (§2.3).
