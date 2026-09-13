#!/usr/bin/env node
// One-off: convert the pro-pregnancy markdown draft into the store.
// After it runs, the draft and this script are removed; both stay in git history.
import { openStore, addVocabulary, addNano, addContract } from '../server/store.mjs';

const SOURCE = 'draft:micro-social-contracts/pro-pregnancy/contract.md@5022a64';
const db = openStore();
if (db.prepare("SELECT 1 FROM contract WHERE id = 'pro-pregnancy'").get()) {
  console.error('pro-pregnancy is already in the store.');
  process.exit(1);
}

const vocab = (table, entries) => Object.entries(entries).forEach(([id, label]) => addVocabulary(db, table, id, label));
vocab('author', {
  jjokulian: 'Jjokulian',
  'claude-draft': 'Drafted with Claude from the contract text, for the authors to review',
});
vocab('role', { society: 'Society', citizens: 'Every citizen', employers: 'Employers', everyone: 'Everyone' });
vocab('term', {
  pregnancy: 'pregnancy', 'human-life-in-the-womb': 'human life in the womb', mother: 'mother',
  abortion: 'abortion', 'extraction-threshold': 'extraction threshold', 'chronic-negative-consequence': 'chronic negative consequence',
});
vocab('unit', {
  'completed-gestational-week': 'completed gestational weeks', week: 'weeks', 'share-of-earnings': 'share of prior earnings',
  month: 'months', 'per-100000-births': 'per 100,000 births', 'per-10000-births': 'per 10,000 births',
  percent: 'percent', ratio: 'ratio', 'currency-per-year': 'currency per resident per year',
});

const db_ = (id, kind, body, filedBy = 'jjokulian') => addNano(db, { id, kind, filedBy, source: SOURCE, ...body }).ref;
const drafted = (id, body) => db_(id, 'claim', body, 'claude-draft');

db.transaction(() => {
  // ── Intents: the authors' own words at the top ──────────────────────────────
  const root = db_('pro-pregnancy', 'intent', { statement: 'Society carries the burdens of pregnancy together' });
  const mothers = db_('protect-mothers', 'intent', { statement: 'To protect mothers' });
  const babies = db_('protect-babies', 'intent', { statement: 'To protect babies' });
  const hallow = db_('hallow-new-human-life', 'intent', { statement: 'To hallow new human life' });
  const delight = db_('make-pregnancy-a-delight', 'intent', { statement: 'To make pregnancy a delight' });
  const health = db_('mothers-lasting-health', 'intent', { statement: 'No mother is left with a lasting injury or illness from pregnancy' });
  const livelihood = db_('mothers-livelihood', 'intent', { statement: 'No mother loses her income, job or home because of pregnancy' });
  const unchosen = db_('mothers-free-of-unchosen-duty', 'intent', { statement: 'No mother carries a parental duty she did not choose' });

  // ── Definitions ────────────────────────────────────────────────────────────
  const definitions = [
    db_('pregnancy', 'definition', { term: 'pregnancy', meaning: 'The condition of carrying human life in the womb, from conception until that life leaves the womb.' }),
    db_('human-life-in-the-womb', 'definition', { term: 'human-life-in-the-womb', meaning: 'The human life form that a pregnancy carries, at every stage.' }),
    db_('mother', 'definition', { term: 'mother', meaning: 'A person who is pregnant, or who is recovering from a pregnancy under this contract.' }),
    db_('abortion.pro-pregnancy', 'definition', { term: 'abortion', meaning:
      'Ending a pregnancy. It happens only (a) by extracting the child from the womb once it can live on its own, at or after the extraction threshold, or (b) by removing the human life in the womb after it has already died. Abortion never overlaps with an act whose effect is to kill the human life in the womb; such an act is not abortion.' }),
    db_('extraction-threshold.pro-pregnancy', 'definition', { term: 'extraction-threshold', meaning:
      'The gestational week at which the child counts as able to live on its own. Adopters set it with the extraction threshold parameter.' }),
    db_('chronic-negative-consequence.pro-pregnancy', 'definition', { term: 'chronic-negative-consequence', meaning:
      'Any lasting harm that follows from a pregnancy: an injury, a loss of income or job, a lost home, stigma, or a parental duty the mother did not choose to take on.' }),
  ];

  // ── Parameters ─────────────────────────────────────────────────────────────
  const threshold = db_('extraction-threshold-week', 'parameter', { label: 'Extraction threshold', unit: 'completed-gestational-week', min: 22, max: 37,
    meaning: 'The earliest week at which a pregnancy may be ended by extraction on request. Earlier shortens the pregnancy a mother must carry; it also raises neonatal intensive care, mortality and lifelong impairment among the children extracted.' });
  const pregnancyLeave = db_('pregnancy-leave-weeks', 'parameter', { label: 'Pregnancy leave', unit: 'week', min: 0, max: 40, meaning: 'Paid leave during pregnancy (average taken), whenever it is needed.' });
  const recoveryLeave = db_('recovery-leave-weeks', 'parameter', { label: 'Recovery leave', unit: 'week', min: 6, max: 52, meaning: 'Paid recovery after the pregnancy ends, whether or not the mother keeps the child.' });
  const replacement = db_('income-replacement', 'parameter', { label: 'Income replacement', unit: 'share-of-earnings', min: 0.5, max: 1, meaning: 'The share of prior earnings paid during leave.' });
  const window = db_('placement-window-months', 'parameter', { label: 'Placement window', unit: 'month', min: 1, max: 36, meaning: 'The time within which guardianship places a handed-over newborn with a permanent family.' });

  // ── Measures (§8) and assumptions ──────────────────────────────────────────
  const m = {
    mortality: db_('maternal-mortality', 'measure', { label: 'Maternal mortality', unit: 'per-100000-births', description: 'Deaths of mothers during or within 42 days of pregnancy, per 100,000 births.' }),
    morbidity: db_('severe-maternal-morbidity', 'measure', { label: 'Severe maternal morbidity', unit: 'per-10000-births', description: 'Life-threatening complications of pregnancy per 10,000 births.' }),
    chronic: db_('chronic-conditions-after-pregnancy', 'measure', { label: 'Chronic conditions after pregnancy', unit: 'percent', description: 'Share of mothers with a pregnancy-caused chronic condition (pelvic-floor dysfunction, incontinence, chronic pain, depression) five years after the pregnancy.' }),
    earnings: db_('earnings-after-pregnancy', 'measure', { label: 'Earnings after pregnancy', unit: 'ratio', description: 'Mothers’ earnings five years after a pregnancy, relative to people of the same age who were not pregnant.' }),
    survival: db_('extraction-survival', 'measure', { label: 'Survival after extraction', unit: 'percent', description: 'Survival to discharge of children born by extraction, reported by week of extraction.' }),
    impairment: db_('extraction-impairment', 'measure', { label: 'Impairment after extraction', unit: 'percent', description: 'Share of surviving children born by extraction with moderate or severe lifelong impairment, by week of extraction.' }),
    placement: db_('placement-within-window-share', 'measure', { label: 'Placed within the window', unit: 'percent', description: 'Share of handed-over newborns placed with a permanent family within the placement window.' }),
    families: db_('adoptive-families-per-relinquished-newborn', 'measure', { label: 'Adoptive families per handed-over newborn', unit: 'ratio', description: 'Approved adoptive families waiting, per newborn handed to guardianship each year.' }),
    levy: db_('levy-per-resident', 'measure', { label: 'Levy per resident', unit: 'currency-per-year', description: 'The pregnancy levy divided by the resident population.' }),
  };
  const enoughFamilies = db_('adoptive-families-exceed-handed-over-newborns', 'assumption', {
    statement: 'There are at least as many approved adoptive families as newborns handed to guardianship.',
    condition: { measure: m.families, op: '>=', value: 1 } });

  // ── Clauses (§3–§5) ────────────────────────────────────────────────────────
  const clause = (id, role, modality, text) => db_(id, 'clause', { role, modality, text });
  const k = {
    prenatal: clause('free-prenatal-care', 'society', 'shall', 'Society provides prenatal care free at the point of use: checkups, scans, tests, midwife and doula support, and treatment of complications.'),
    comfort: clause('comfort-care-standard', 'society', 'shall', 'Society provides comfort care as standard care, not as extras: treatment of nausea and hyperemesis, pain management, physiotherapy, mobility aids and help at home.'),
    mental: clause('perinatal-mental-health', 'society', 'shall', 'Society provides perinatal mental-health care on request, without a waiting list.'),
    navigator: clause('pregnancy-navigator', 'society', 'shall', 'Society gives each mother one named navigator who coordinates every service in this contract, and a phone line that answers 24 hours a day.'),
    birth: clause('birth-at-term-care', 'society', 'shall', 'Society provides care for birth at term.'),
    extraction: clause('extraction-on-request', 'society', 'shall', 'On the mother’s request, society provides extraction of the child at or after the extraction threshold, with the child going straight into neonatal care.'),
    loss: clause('pregnancy-loss-care', 'society', 'shall', 'When the human life in the womb has died, society provides care to remove it, and bereavement support.'),
    recovery: clause('twelve-month-recovery', 'society', 'shall', 'Society provides twelve months of postpartum care, including pelvic-floor and abdominal rehabilitation and mental-health follow-up, whatever the outcome of the pregnancy.'),
    leave: clause('paid-pregnancy-and-recovery-leave', 'society', 'shall', 'Society pays pregnancy leave and recovery leave at the income replacement rate. Mothers without earnings receive a flat allowance.'),
    job: clause('job-protection', 'employers', 'shall', 'Employers protect the job of a mother who is pregnant or recovering, and make the workplace accommodations the mother needs.'),
    residence: clause('maternity-residence-and-confidential-birth', 'society', 'shall', 'On request, society provides a place in a maternity residence away from home, and the option of a confidential birth.'),
    guardianship: clause('guardianship-transfer', 'society', 'shall', 'A mother who does not want to raise the child may hand it to guardianship at birth or extraction. The handover releases the mother from every parental duty, including paying for the child, and carries no stigma.'),
    placement: clause('placement-within-window', 'society', 'shall', 'Guardianship places each handed-over child with a permanent family within the placement window.'),
    injury: clause('lasting-injury-care', 'society', 'shall', 'Society provides lifelong care for injuries caused by a pregnancy, and a no-fault compensation fund.'),
    extractedCare: clause('care-for-children-born-by-extraction', 'society', 'shall', 'Society provides neonatal intensive care, developmental follow-up and lifelong support for any impairment that results from early extraction.'),
    levy: clause('pregnancy-levy', 'citizens', 'shall', 'Every citizen pays the pregnancy levy that funds this contract.'),
    nondiscrimination: clause('pregnancy-non-discrimination', 'everyone', 'shall not', 'No one discriminates against a person because they are pregnant, have been pregnant, or chose guardianship transfer.'),
    noKilling: clause('no-killing-life-in-the-womb', 'everyone', 'shall not', 'No one performs, procures or assists an act whose effect is to kill the human life in the womb.'),
    entitlements: clause('services-are-entitlements', 'society', 'shall not', 'Society does not compel any mother to accept a service in this contract. Every service is an entitlement, not a duty.'),
  };

  // ── Claims drafted from the text; the contract endorses the supporting ones ─
  const c = [
    drafted('prenatal-care-guards-mothers-health', { from: k.prenatal, relation: 'supports', to: health, measuredBy: [m.morbidity, m.mortality],
      rationale: 'Regular prenatal care finds pre-eclampsia, gestational diabetes and anaemia early.' }),
    drafted('prenatal-care-protects-babies', { from: k.prenatal, relation: 'supports', to: babies,
      rationale: 'Prenatal care finds growth restriction and infections before they harm the baby.' }),
    drafted('comfort-care-makes-pregnancy-a-delight', { from: k.comfort, relation: 'supports', to: delight,
      rationale: 'Treating nausea, pain and immobility as standard care removes the everyday misery of pregnancy.' }),
    drafted('mental-health-care-guards-mothers-health', { from: k.mental, relation: 'supports', to: health, measuredBy: [m.chronic],
      rationale: 'Perinatal depression untreated becomes chronic; treated without delay, it usually resolves.' }),
    drafted('mental-health-care-makes-pregnancy-a-delight', { from: k.mental, relation: 'supports', to: delight,
      rationale: 'Anxiety and depression are among the heaviest burdens of pregnancy.' }),
    drafted('navigator-makes-pregnancy-a-delight', { from: k.navigator, relation: 'supports', to: delight,
      rationale: 'One person who arranges everything takes the administrative load off the mother.' }),
    drafted('birth-care-protects-babies', { from: k.birth, relation: 'supports', to: babies,
      rationale: 'Skilled care at birth prevents most intrapartum deaths and injuries.' }),
    drafted('birth-care-guards-mothers-health', { from: k.birth, relation: 'supports', to: health, measuredBy: [m.mortality],
      rationale: 'Skilled care at birth prevents haemorrhage deaths and severe tears.' }),
    drafted('extraction-protects-mothers', { from: k.extraction, relation: 'supports', to: mothers,
      rationale: 'A mother who does not want to continue can end the pregnancy at the threshold instead of at term.' }),
    drafted('extracted-children-care-protects-babies', { from: k.extractedCare, relation: 'supports', to: babies, given: [k.extraction],
      measuredBy: [m.survival, m.impairment], rationale: 'Children extracted early get the intensive and lifelong care their prematurity requires.' }),
    drafted('loss-care-guards-mothers-health', { from: k.loss, relation: 'supports', to: health,
      rationale: 'Timely care after a pregnancy loss prevents infection and haemorrhage; bereavement support prevents lasting grief disorders.' }),
    drafted('recovery-care-guards-mothers-health', { from: k.recovery, relation: 'supports', to: health, measuredBy: [m.chronic],
      rationale: 'Pelvic-floor and abdominal rehabilitation in the first year prevents most chronic incontinence and pain.' }),
    drafted('injury-care-guards-mothers-health', { from: k.injury, relation: 'supports', to: health, measuredBy: [m.chronic],
      rationale: 'Injuries that do become lasting are cared for for life, and compensated without a fight over fault.' }),
    drafted('leave-and-job-secure-livelihood', { from: k.leave, relation: 'supports', to: livelihood, strength: 'sufficient', given: [k.job],
      when: [{ parameter: replacement, op: '>=', value: 1 }], measuredBy: [m.earnings],
      rationale: 'Full pay during leave, with the job held open, means pregnancy costs no income and no job.' }),
    drafted('job-protection-secures-livelihood', { from: k.job, relation: 'supports', to: livelihood,
      rationale: 'The mother returns to the same job after pregnancy.' }),
    drafted('residence-secures-home', { from: k.residence, relation: 'supports', to: livelihood,
      rationale: 'A mother who loses her home, or must leave it, has a place to live throughout.' }),
    drafted('non-discrimination-secures-livelihood', { from: k.nondiscrimination, relation: 'supports', to: livelihood,
      rationale: 'Employers and landlords cannot penalise a mother for a pregnancy or a handover.' }),
    drafted('guardianship-frees-mothers', { from: k.guardianship, relation: 'supports', to: unchosen, strength: 'sufficient',
      rationale: 'The handover ends every parental duty, including paying for the child.' }),
    drafted('guardianship-protects-babies', { from: k.guardianship, relation: 'supports', to: babies, given: [k.placement],
      when: [{ parameter: window, op: '<=', value: 12 }], assuming: [enoughFamilies], measuredBy: [m.placement],
      rationale: 'Handed-over newborns are placed with permanent families within the year, so none grow up in institutional care.' }),
    drafted('no-killing-protects-babies', { from: k.noKilling, relation: 'supports', to: babies,
      rationale: 'The human life in the womb is never killed to end a pregnancy.' }),
    drafted('no-killing-hallows-new-life', { from: k.noKilling, relation: 'supports', to: hallow,
      rationale: 'New human life is treated as inviolable from conception.' }),
    drafted('levy-shares-the-burden', { from: k.levy, relation: 'supports', to: root,
      rationale: 'Every citizen pays for the care, so no mother pays for her pregnancy alone.' }),
    drafted('entitlements-protect-mothers', { from: k.entitlements, relation: 'supports', to: mothers,
      rationale: 'No mother is compelled into treatment, residence or handover.' }),
  ];

  // Filed for evaluation, not endorsed: the trade-off the extraction threshold controls.
  drafted('early-extraction-endangers-babies', { from: k.extraction, relation: 'hinders', to: babies,
    when: [{ parameter: threshold, op: '<', value: 32 }], measuredBy: [m.survival, m.impairment],
    rationale: 'Children extracted before about 32 weeks face markedly higher mortality and lifelong impairment than children born at term, and the earlier the week, the higher the risk.' });

  addContract(db, {
    id: 'pro-pregnancy', scale: 'micro', title: 'Pro-Pregnancy', status: 'draft', filedBy: 'jjokulian', source: SOURCE,
    intents: [
      { ref: root, combine: 'all' },
      { ref: mothers, parent: root, combine: 'all' },
      { ref: health, parent: mothers }, { ref: livelihood, parent: mothers }, { ref: unchosen, parent: mothers },
      { ref: babies, parent: root }, { ref: hallow, parent: root }, { ref: delight, parent: root },
    ],
    members: [...Object.values(k), ...definitions, ...Object.values(m), enoughFamilies, ...c],
    parameters: { [threshold]: 28, [pregnancyLeave]: 6, [recoveryLeave]: 16, [replacement]: 1, [window]: 12 },
  });
})();

console.log('Converted pro-pregnancy into the store.');
