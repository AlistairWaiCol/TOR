/** Compendium seed data and the catalogue → character-sheet conversions. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMPENDIUM_SECTIONS,
  CORE_VIRTUES,
  ITEM_KINDS,
  STANDARDS_OF_LIVING,
  catalogueItemToArmour,
  catalogueItemToShield,
  catalogueItemToWeapon,
  coreCatalogueItems,
  coreRewardDefinitions,
  isVersatileWeapon,
  livingStandardRank,
  normaliseYears,
  standardOfLivingWarning,
} from '../shared/compendium.js';
import {
  CULTURAL_VIRTUES,
  CULTURAL_VIRTUE_CULTURES,
  culturalVirtuesFor,
} from '../shared/culturalVirtues.js';
import { ARMOUR_QUALITIES, SHIELD_QUALITIES, WEAPON_QUALITIES } from '../shared/rewards.js';
import { effectiveArmour, effectiveShield, effectiveWeapon, gripInjury } from '../shared/rewards.js';
import {
  PROFICIENCY_GROUPS,
  emptyArmour,
  emptyWeapon,
  hydrateSheet,
  totalLoad,
  totalProtection,
} from '../shared/character.js';

describe('Compendium sections', () => {
  it('declares the five sections, with Virtues split general vs cultural', () => {
    assert.deepEqual(
      COMPENDIUM_SECTIONS.map((s) => s.key),
      ['virtues', 'culturalVirtues', 'rewards', 'items', 'locations'],
    );
    assert.equal(COMPENDIUM_SECTIONS.find((s) => s.key === 'virtues').label, 'General Virtues');
    assert.equal(
      COMPENDIUM_SECTIONS.find((s) => s.key === 'culturalVirtues').label,
      'Cultural Virtues',
    );
  });

  it('catalogues exactly the three gear shapes a sheet holds', () => {
    assert.deepEqual(ITEM_KINDS, ['weapon', 'armour', 'shield']);
  });
});

describe('core Virtues', () => {
  it('seeds the six core-rulebook Virtues, each with effect text', () => {
    assert.equal(CORE_VIRTUES.length, 6);
    assert.deepEqual(
      CORE_VIRTUES.map((v) => v.name),
      ['Confidence', 'Dour-handed', 'Hardiness', 'Mastery', 'Nimbleness', 'Prowess'],
    );
    for (const v of CORE_VIRTUES) assert.ok(v.effect.trim().length > 5, `${v.name} has no effect`);
  });
});

describe('core Rewards', () => {
  const rewards = coreRewardDefinitions();

  it('is the six core Rewards, taken from the sheet quality tables', () => {
    assert.deepEqual(
      rewards.map((r) => r.name).sort(),
      ['Close-fitting', 'Cunning Make', 'Fell', 'Grievous', 'Keen', 'Reinforced'],
    );
  });

  it('lists Cunning Make once, applying to both armour and shields', () => {
    // The two quality tables share the same object, so it must not be duplicated.
    assert.equal(SHIELD_QUALITIES.cunningMake, ARMOUR_QUALITIES.cunningMake);
    const cm = rewards.filter((r) => r.name === 'Cunning Make');
    assert.equal(cm.length, 1);
    assert.deepEqual(cm[0].appliesTo, ['armour', 'shield']);
  });

  it('keeps every enhanced tier and drops the "None" option', () => {
    const fell = rewards.find((r) => r.name === 'Fell');
    assert.equal(fell.code, WEAPON_QUALITIES.fell.code);
    assert.equal(fell.summary, WEAPON_QUALITIES.fell.summary);
    assert.deepEqual(
      fell.tiers.map((t) => t.value),
      ['standard', 'enhanced_elven', 'enhanced_numenorean'],
    );
    for (const reward of rewards) {
      assert.ok(!reward.tiers.some((t) => t.value === 'none'), `${reward.name} still lists None`);
      assert.ok(reward.tiers.length > 0, `${reward.name} has no tiers`);
    }
  });
});

describe('catalogue entries become sheet rows', () => {
  const axe = {
    kind: 'weapon',
    name: 'Long-hafted axe',
    type: 'Axe',
    proficiency: 'Axes',
    damage: 6,
    injury: 18,
    load: 4,
    notes: 'two-handed',
  };

  it('fills a weapon row and leaves its Reward tiers unset', () => {
    const w = { ...emptyWeapon(), ...catalogueItemToWeapon(axe) };
    assert.equal(w.name, 'Long-hafted axe');
    assert.equal(w.proficiency, 'Axes');
    assert.equal(w.damage, 6);
    assert.equal(w.load, 4);
    assert.equal(w.equipped, false, 'a catalogued item arrives unequipped');
    // Reward qualities belong to the hero's copy, not the catalogue entry.
    assert.deepEqual([w.fell, w.grievous, w.keen], ['none', 'none', 'none']);
    assert.ok(w.id, 'the sheet row keeps its own id');
    assert.deepEqual(effectiveWeapon(w).damage, 6);
  });

  it('fills an armour row', () => {
    const a = {
      ...emptyArmour(),
      ...catalogueItemToArmour({ name: 'Mail shirt', protection: 3, load: 12 }),
    };
    assert.equal(a.protection, 3);
    assert.equal(a.load, 12);
    assert.deepEqual([a.closeFitting, a.cunningMake], ['none', 'none']);
    assert.equal(effectiveArmour(a).load, 12);
  });

  it('fills the shield slot', () => {
    const s = catalogueItemToShield({ name: 'Great shield', parry: 3, load: 6 });
    assert.equal(s.parry, 3);
    assert.equal(effectiveShield(s).parry, 3);
  });

  it('feeds straight into the computed Load once equipped', () => {
    const sheet = hydrateSheet({
      weapons: [{ ...emptyWeapon(), ...catalogueItemToWeapon(axe), equipped: true }],
      armour: [
        {
          ...emptyArmour(),
          ...catalogueItemToArmour({ name: 'Mail shirt', protection: 3, load: 12 }),
          equipped: true,
        },
      ],
    });
    assert.equal(totalLoad(sheet), 16);
  });
});

/* --- the seeded core gear tables ------------------------------------------- */

describe('core weapon / armour / shield catalogue', () => {
  const items = coreCatalogueItems();
  const byName = (kind, name) => items.find((i) => i.kind === kind && i.name === name);

  it('seeds 16 weapons, 5 pieces of armour and 3 shields, all as core', () => {
    assert.equal(items.filter((i) => i.kind === 'weapon').length, 16);
    assert.equal(items.filter((i) => i.kind === 'armour').length, 5);
    assert.equal(items.filter((i) => i.kind === 'shield').length, 3);
    for (const item of items) assert.equal(item.source, 'core', `${item.name} is not core`);
  });

  it('maps every weapon onto an existing proficiency group', () => {
    for (const w of items.filter((i) => i.kind === 'weapon')) {
      assert.ok(PROFICIENCY_GROUPS.includes(w.proficiency), `${w.name}: ${w.proficiency}`);
    }
  });

  it('gives exactly three weapons a second Injury rating, one per grip', () => {
    const versatile = items.filter((i) => i.kind === 'weapon' && isVersatileWeapon(i));
    assert.deepEqual(
      versatile.map((w) => w.name),
      ['Long Sword', 'Spear', 'Long-hafted Axe'],
    );
    // Damage stays a single flat value even for those three.
    assert.deepEqual(
      versatile.map((w) => [w.damage, w.injury, w.injuryTwoHanded]),
      [
        [5, 16, 18],
        [4, 14, 16],
        [6, 18, 20],
      ],
    );
  });

  it('stores Unarmed with Injury 0 and keeps the caveat in its Notes', () => {
    const unarmed = byName('weapon', 'Unarmed');
    assert.equal(unarmed.injury, 0);
    assert.match(unarmed.notes, /Cannot cause a Piercing Blow/);
  });

  it('strips the rulebook footnote asterisks from names', () => {
    for (const item of items) assert.ok(!item.name.includes('*'), item.name);
    assert.ok(byName('armour', 'Mail-shirt'));
    assert.ok(byName('armour', 'Coat of Mail'));
    assert.ok(byName('shield', 'Shield'));
    assert.ok(byName('shield', 'Great Shield'));
  });

  it('stores Protection as the plain number behind the "1d" notation', () => {
    assert.deepEqual(
      items.filter((i) => i.kind === 'armour').map((a) => [a.name, a.protection]),
      [
        ['Leather Shirt', 1],
        ['Leather Corslet', 2],
        ['Mail-shirt', 3],
        ['Coat of Mail', 4],
        ['Helm', 1],
      ],
    );
  });

  it("carries armour's Type as a Compendium-only grouping field", () => {
    assert.equal(byName('armour', 'Mail-shirt').type, 'Mail armour');
    assert.equal(byName('armour', 'Helm').type, 'Headgear');
    // catalogueItemToArmour() must not push Type onto the sheet's armour rows.
    assert.ok(!('type' in catalogueItemToArmour(byName('armour', 'Helm'))));
  });

  it('maps Parry Modifier onto the shield slot', () => {
    assert.deepEqual(
      items.filter((i) => i.kind === 'shield').map((s) => [s.name, s.parry, s.load]),
      [
        ['Buckler', 1, 2],
        ['Shield', 2, 4],
        ['Great Shield', 3, 6],
      ],
    );
  });

  it('uses the explicit Minimum Standard of Living mapping, not the asterisks', () => {
    const needs = Object.fromEntries(
      items.filter((i) => i.minStandard).map((i) => [i.name, i.minStandard]),
    );
    assert.deepEqual(needs, {
      'Mail-shirt': 'Common',
      Shield: 'Common',
      'Coat of Mail': 'Prosperous',
      'Great Shield': 'Prosperous',
    });
    // Helm carries a single asterisk in the source table but is explicitly
    // "none" here — see the README's judgment-call log.
    assert.equal(byName('armour', 'Helm').minStandard, '');
    for (const w of items.filter((i) => i.kind === 'weapon')) assert.equal(w.minStandard, '');
  });

  it('sums a Helm onto body armour with no special stacking logic', () => {
    const sheet = hydrateSheet({
      armour: [
        { ...emptyArmour(), ...catalogueItemToArmour(byName('armour', 'Mail-shirt')), equipped: true },
        { ...emptyArmour(), ...catalogueItemToArmour(byName('armour', 'Helm')), equipped: true },
      ],
    });
    assert.equal(totalProtection(sheet).total, 4);
    assert.equal(totalLoad(sheet), 13);
  });
});

describe('weapon grip', () => {
  const longSword = coreCatalogueItems().find((i) => i.name === 'Long Sword');

  it('arrives one-handed and reports the one-handed Injury', () => {
    const w = { ...emptyWeapon(), ...catalogueItemToWeapon(longSword) };
    assert.equal(w.grip, '1h');
    assert.equal(w.injuryTwoHanded, 18);
    assert.equal(gripInjury(w), 16);
    assert.equal(effectiveWeapon(w).injury, 16);
  });

  it('switches to the two-handed Injury without changing Damage', () => {
    const w = { ...emptyWeapon(), ...catalogueItemToWeapon(longSword), grip: '2h' };
    assert.equal(gripInjury(w), 18);
    const eff = effectiveWeapon(w);
    assert.equal(eff.injury, 18);
    assert.equal(eff.damage, 5, 'Damage is one flat value for both grips');
  });

  it('stacks Fell on top of whichever grip is in use', () => {
    const w = { ...emptyWeapon(), ...catalogueItemToWeapon(longSword), grip: '2h', fell: 'standard' };
    const eff = effectiveWeapon(w);
    assert.equal(eff.baseInjury, 18);
    assert.equal(eff.injury, 20);
  });

  it('ignores a stray grip on a weapon with only one Injury rating', () => {
    const sword = coreCatalogueItems().find((i) => i.name === 'Sword');
    const w = { ...emptyWeapon(), ...catalogueItemToWeapon(sword) };
    assert.equal(isVersatileWeapon(w), false);
    assert.equal(w.grip, '', 'a single-Injury weapon carries no grip');
    // Even if a grip is somehow set, there is no second rating to switch to.
    assert.equal(gripInjury({ ...w, grip: '2h' }), 16);
    assert.equal(effectiveWeapon({ ...w, grip: '2h' }).injury, 16);
  });
});

describe('Minimum Standard of Living is a hint, not a gate', () => {
  it('ranks the standards poorest first', () => {
    assert.equal(livingStandardRank('Poor'), 0);
    assert.equal(livingStandardRank('very rich'), STANDARDS_OF_LIVING.length - 1);
    assert.equal(livingStandardRank(''), -1);
    assert.equal(livingStandardRank('Comfortable'), -1, 'home-brew standards are unranked');
  });

  it('says nothing when the item asks for nothing, or the hero is rich enough', () => {
    assert.equal(standardOfLivingWarning({ name: 'Buckler', minStandard: '' }, 'Poor'), '');
    assert.equal(standardOfLivingWarning({ name: 'Shield', minStandard: 'Common' }, 'Common'), '');
    assert.equal(standardOfLivingWarning({ name: 'Shield', minStandard: 'Common' }, 'Rich'), '');
  });

  it('warns — in prose, so nothing can act on it — when the hero is below it', () => {
    const msg = standardOfLivingWarning({ name: 'Coat of Mail', minStandard: 'Prosperous' }, 'Frugal');
    assert.match(msg, /Coat of Mail/);
    assert.match(msg, /Prosperous/);
    assert.match(msg, /Frugal/);
  });

  it('warns when the sheet has no Standard of Living recorded at all', () => {
    assert.match(
      standardOfLivingWarning({ name: 'Mail-shirt', minStandard: 'Common' }, ''),
      /none recorded/,
    );
  });
});

/* --- Cultural Virtues -------------------------------------------------------- */

describe('Cultural Virtues', () => {
  it('imports all 60 rows across the ten cultures', () => {
    assert.equal(CULTURAL_VIRTUES.length, 60);
    assert.equal(CULTURAL_VIRTUE_CULTURES.length, 10);
    assert.deepEqual(
      [...new Set(CULTURAL_VIRTUES.map((v) => v.culture))].sort(),
      [...CULTURAL_VIRTUE_CULTURES].sort(),
    );
  });

  it('gives every entry a name, a culture and real description text', () => {
    for (const v of CULTURAL_VIRTUES) {
      assert.ok(v.name.trim(), 'unnamed cultural virtue');
      assert.ok(v.culture.trim(), `${v.name} has no culture`);
      assert.ok(v.description.trim().length > 20, `${v.name} has no description`);
    }
  });

  it('is keyed on (name, culture) — names repeat across cultures', () => {
    const pairs = CULTURAL_VIRTUES.map((v) => `${v.name}|${v.culture}`);
    assert.equal(new Set(pairs).size, 60, 'a (name, culture) pair is duplicated');
    const names = new Set(CULTURAL_VIRTUES.map((v) => v.name));
    assert.ok(names.size < 60, 'expected some Virtue names to appear under several cultures');
  });

  it("drops the research note from the Beornings' Brother to Bears", () => {
    const v = CULTURAL_VIRTUES.find(
      (x) => x.name === 'Brother to Bears' && x.culture === 'Beornings',
    );
    assert.ok(v);
    assert.ok(!v.description.includes('verify the exact symbol'), 'research note still present');
    assert.match(v.description, /Gandalf rune, with an Injury rating of 12/);
  });

  it("keeps the Bree Hobbits' rules parenthetical, which is real rules text", () => {
    const bree = CULTURAL_VIRTUES.filter((v) => v.culture === 'Bree Hobbits');
    assert.equal(bree.length, 6);
    for (const v of bree) assert.match(v.description, /The Big and the Little/);
  });

  it('looks a culture up case-insensitively and returns [] for nothing', () => {
    assert.equal(culturalVirtuesFor('Beornings').length, 6);
    assert.equal(culturalVirtuesFor('  beornings ').length, 6);
    assert.deepEqual(culturalVirtuesFor(''), []);
    assert.deepEqual(culturalVirtuesFor('Ents of Fangorn'), []);
  });
});

describe('Location years', () => {
  it('accepts a comma-separated string and de-dupes', () => {
    assert.deepEqual(normaliseYears('2946, 2947, 2946'), ['2946', '2947']);
  });

  it('accepts a list and drops blanks', () => {
    assert.deepEqual(normaliseYears(['2946', '', '  ', '2950']), ['2946', '2950']);
  });

  it('copes with nothing at all', () => {
    assert.deepEqual(normaliseYears(undefined), []);
    assert.deepEqual(normaliseYears(''), []);
  });
});
