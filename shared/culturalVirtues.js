/**
 * Cultural Virtues (TOR 2e core rulebook + Ruins of the Lost Realm / Rivendell
 * culture lists), one entry per culture-specific Virtue.
 *
 * Kept in its own module rather than in shared/compendium.js: it is 60 rows of
 * transcribed rules text, and compendium.js is the place people read to learn
 * how the Compendium is *shaped*.
 *
 * Descriptions are transcribed rather than summarised, unlike the terse core
 * Virtue effects in shared/compendium.js — a Cultural Virtue's wording usually
 * carries the whole rule. Worth a glance against your book before leaning on
 * the exact numbers.
 *
 * Seeded as `source: 'core'`, so re-seeding refreshes these in place and never
 * touches a home-brew row.
 */

export const CULTURAL_VIRTUES = [
  {
    name: 'Cram',
    culture: 'Bardings',
    description:
      'Taught the ancient recipe for cram, a long-lasting travel biscuit. Each time you gain Fatigue from a Journey Event, you gain 1 point less; additionally, when you take a Short Rest, you and all Company members regain extra Endurance equal to your Wisdom rating.',
  },
  {
    name: 'Dragon-Slayer',
    culture: 'Bardings',
    description:
      'Inspired by the legend of Bard the Bowman, you have long studied how to bring down great monsters. When fighting creatures with Might 2 or more, all your attack rolls are Favoured.',
  },
  {
    name: 'Dwarf-Friend',
    culture: 'Bardings',
    description:
      'The days of the Dragon forged a strong alliance between the Bardings and the Dwarves of Erebor. If your Fellowship focus is a Dwarf, whoever is fighting in a Defensive stance may attempt Protect Companion as a secondary action to benefit the other; Dwarves are always considered Friendly toward you during the Interaction stage of a council.',
  },
  {
    name: 'Fierce Shot',
    culture: 'Bardings',
    description:
      'Your grip is steady and your aim true with spear or bow, like the hand that loosed the Black Arrow against Smaug. When you score a Piercing Blow on a ranged attack, the target\'s Protection roll is Ill-favoured.',
  },
  {
    name: 'High Destiny',
    culture: 'Bardings',
    description:
      'Stories tell that those of the bloodline of Dale are destined for greatness. Raise your maximum Endurance by 1. The first time you would receive a deadly wound, you are instead saved by chance and left Wounded but alive, and you raise your maximum Hope by 1 (this can happen only once).',
  },
  {
    name: 'The Language of Birds',
    culture: 'Bardings',
    description:
      'Dalemen can grow wise enough to understand the speech of birds, gaining warning of danger from their song. You can communicate with birds using Courtesy, Persuade, or Song; additionally, once per Combat, Council, or Journey while outdoors, you can choose to become Inspired on any one roll.',
  },
  {
    name: 'Baruk Khazâd!',
    culture: 'Dwarves of Durin\'s Folk',
    description:
      'The secret tongue of the Dwarves is guarded as a treasure of the past, but their battle-cry is well-known and feared by their foes. Once per combat, when fighting in a Forward stance, you can make your attack roll Favoured and attempt the Intimidate Foe combat task as a secondary action.',
  },
  {
    name: 'Broken Spells',
    culture: 'Dwarves of Durin\'s Folk',
    description:
      'You have been taught fragments of the old, powerful enchantments of the Dwarves. Choose three Skills in which you have at least one rank and mark them; whenever you use one of these Skills, you can spend 1 Hope to achieve a Magical success.',
  },
  {
    name: 'Dark for Dark Business',
    culture: 'Dwarves of Durin\'s Folk',
    description:
      'Your kind is untroubled by darkness and has grown to favour it over the light. When you are in the dark (at night or underground) you are Inspired on all your rolls.',
  },
  {
    name: 'Durin\'s Way',
    culture: 'Dwarves of Durin\'s Folk',
    description:
      'Trained by generations of war fought in deep places beneath the earth, you know how to exploit corners, darkness, and other obstacles. Add +2 to your Parry rating when fighting underground or in otherwise cramped quarters, such as inside a building.',
  },
  {
    name: 'Stone-Hard',
    culture: 'Dwarves of Durin\'s Folk',
    description:
      'Dwarves were made to be strong and to endure. Raise your maximum Endurance by 1. All your Protection rolls are Favoured, as long as you are not Miserable.',
  },
  {
    name: 'Untameable Spirit',
    culture: 'Dwarves of Durin\'s Folk',
    description:
      'Dwarves were made from their beginning to resist domination, and your resolve is strengthened against all but the most subtle weapons of the Enemy. Raise your maximum Hope by 1 point; gain a bonus Feat die on all Shadow Tests made to resist the effects of Sorcery.',
  },
  {
    name: 'Against the Unseen',
    culture: 'Elves of Lindon',
    description:
      'You have strengthened your heart against the terrors of the wraith-world, perceiving spirits and ghosts even when invisible to the living. All your Shadow Tests due to Dread are Favoured, and you gain a bonus Feat die on those rolls forced upon you by an evil spirit or ghost (including a creature possessed by one).',
  },
  {
    name: 'Deadly Archery',
    culture: 'Elves of Lindon',
    description:
      'The natural Elvish talent for the bow has been honed in you to near perfection. When using a Bow (not a Great Bow) while fighting in Rearward stance, you may attempt the Prepare Shot combat task as a secondary action.',
  },
  {
    name: 'Elbereth Gilthoniel!',
    culture: 'Elves of Lindon',
    description:
      'You have learned to call on the name of Elbereth, Queen of the Stars, in moments of great need, asking her to bestow grace upon you. Raise your maximum Hope by 1; during the Adventuring Phase you can become Inspired on a number of rolls equal to your Wisdom rating.',
  },
  {
    name: 'Elvish Dreams',
    culture: 'Elves of Lindon',
    description:
      'Your spirit is strong enough that you no longer need true sleep, resting your mind while engaged in simple, repetitive activity instead. You don\'t need to sleep under these conditions; when you take a Short Rest, you are considered to have had a Prolonged Rest instead.',
  },
  {
    name: 'Gleam of Wrath',
    culture: 'Elves of Lindon',
    description:
      'The cold, bitter hatred your kindred bear for the Enemy infuses your weapons with a gleam of chill flame. On a successful attack roll, your adversary additionally loses 1 point of Hate or Resolve, plus 1 more for each Success icon rolled.',
  },
  {
    name: 'Memory of Ancient Days',
    culture: 'Elves of Lindon',
    description:
      'Your memory stretches back to a time before Eriador became desolate, and your knowledge of the land returns as you travel. When targeted by a Journey Event while in a Wild Land, roll as if you were in a Border Land instead (or a Wild Land if you are in a Dark Land); additionally, you may always cover the Scout role in addition to your chosen role.',
  },
  {
    name: 'Art of Disappearing',
    culture: 'Hobbits of the Shire',
    description:
      'Hobbits can vanish from notice so quickly and quietly that it seems supernatural to others. Given any opportunity, however small, to hide or sneak away, make a Stealth roll — on a success, you simply disappear, and can choose to reveal yourself again at any moment.',
  },
  {
    name: 'Brave at a Pinch',
    culture: 'Hobbits of the Shire',
    description:
      'Hobbits find hidden reserves of courage once truly cornered. As long as you are Miserable, Weary, or Wounded, you are Inspired on all your rolls.',
  },
  {
    name: 'Small Folk',
    culture: 'Hobbits of the Shire',
    description:
      'Your small stature is turned to advantage in a fight against bigger foes. Add +2 to your Parry rating when in close combat with a creature bigger than you; additionally, you may assume a Rearward stance even if only one other Company member is fighting in Close Combat stance.',
  },
  {
    name: 'Sure at the Mark',
    culture: 'Hobbits of the Shire',
    description:
      'Nimble and keen-eyed, you have honed a natural Hobbit talent for accuracy to perfection, even with a thrown stone. All your ranged attacks are Favoured; if you attack by throwing a stone, the roll produces a Piercing Blow on a result of the Gandalf rune on the Feat die, with an Injury rating of 12.',
  },
  {
    name: 'Three is Company',
    culture: 'Hobbits of the Shire',
    description:
      'Trusting friendship over wisdom, you have given your trust fully to your fellow Company members, and true friendship has grown from the bond. Raise your Company\'s Fellowship rating by 1 point; additionally, you may select a second Fellowship Focus.',
  },
  {
    name: 'Tough as Old Tree-Roots',
    culture: 'Hobbits of the Shire',
    description:
      'Hobbits are hard to dismay or kill, and recover their health at a remarkable pace given some peace and quiet. When Wounded and rolling to determine injury severity, roll two Feat Dice and take the better result; additionally, double your Strength score when calculating Endurance recovered while resting.',
  },
  {
    name: 'Bree-Pony',
    culture: 'Men of Bree',
    description:
      'You have acquired an unusually brave and intelligent Bree-pony that follows you everywhere and never truly leaves your side — if separated, it can be found where you left it or will make its own way back to Bree. Raise your maximum Hope by 1; your pony has a Vigour rating of 4 regardless of your Standard of Living.',
  },
  {
    name: 'Defiance',
    culture: 'Men of Bree',
    description:
      'Though many realms have risen and fallen in the Lone-lands, the Bree-men have endured, revealing unexpected strength and vigour in adversity. Raise your maximum Endurance by 1; at the end of each Combat scene, if you are not Wounded or Miserable, recover Endurance equal to your Heart or Wisdom score.',
  },
  {
    name: 'Desperate Courage',
    culture: 'Men of Bree',
    description:
      'Though you have only known sheltered troubles like brigands or wolves, you are resolved to stand against the Shadow in the East no matter the cost. When you spend Hope on a roll, you can choose to also gain 1 Shadow to become Inspired for that roll.',
  },
  {
    name: 'Friendly and Familiar',
    culture: 'Men of Bree',
    description:
      'Your folk\'s custom of trading with foreigners, and your friendly manner, easily win the sympathy of those you meet and open opportunities to learn from them. Raise by 1 the maximum number of Skill rolls you may attempt during a council; additionally, folk you encounter are always considered Friendly toward you.',
  },
  {
    name: 'Strange as News from Bree',
    culture: 'Men of Bree',
    description:
      'The most inquisitive of the Bree-folk are always ready to gather tidings from travellers passing through. During each Fellowship Phase, you receive a rumour from the Loremaster; additionally, while in the Bree-land, you gain a bonus Feat die on Insight and Riddle rolls.',
  },
  {
    name: 'The Art of Smoking',
    culture: 'Men of Bree',
    description:
      'You have mastered the art of smoking pipe-weed, always carrying your pipe and a bag of tobacco, which grants you patience and clarity of mind. Whenever you regain one or more points of Hope, you recover one additional Hope point (in either the Adventuring or Fellowship Phase).',
  },
  {
    name: 'Endurance of the Ranger',
    culture: 'Rangers of the North',
    description:
      'It is said a Ranger with a clear trail to follow can never be weary. Raise your maximum Endurance by 1; if you wear a suit of Leather armour (with no helm) or no armour at all, and carry no shield, you never gain Fatigue during a journey.',
  },
  {
    name: 'Foresight of Their Kindred',
    culture: 'Rangers of the North',
    description:
      'You retain a measure of the foresight your Númenórean ancestors possessed in full, manifesting as a sense of watchfulness that warns of danger not yet come. During an Adventuring Phase, invoke this gift a number of times equal to your Wisdom rating, on yourself or another Company member, to reroll all the dice involved in any one roll.',
  },
  {
    name: 'Heir of Arnor',
    culture: 'Rangers of the North',
    description:
      'An artefact going back to the days of lost Arnor has passed unbroken through your family line, and you have now been deemed worthy to become its keeper. With the Loremaster, use the Artefact-creation rules to create either a Marvellous Artefact or a Famous Weapon possessing a single Enchanted Reward and up to 2 normal Rewards.',
  },
  {
    name: 'Royalty Revealed',
    culture: 'Rangers of the North',
    description:
      'Though your kin have learned to hide their royal bloodline from enemies, revealing your heritage — by battle-cry, a weapon of high lineage, or a device or coat of arms — steels your allies\' resolve. Once per combat, fighting in an Open stance, you may attempt the Rally Comrades combat task as a secondary action; additionally, the whole Company (including you) is Inspired on all rolls in the following round.',
  },
  {
    name: 'Strength of Will',
    culture: 'Rangers of the North',
    description:
      'Raised amid desolate ruins and haunted barrows where the dead whisper and ghostly lights dance, there is hardly anything left in this world that can dismay you. Gain a bonus Feat die on all Shadow Tests made to resist the effects of Dread.',
  },
  {
    name: 'Ways of the Wild',
    culture: 'Rangers of the North',
    description:
      'The Wild has become as familiar to you as the road home is to a Hobbit, and the land itself may reveal useful tidings. Whenever making a roll using Explore, Hunting, or Travel, you can spend 1 Hope to achieve a Magical success; additionally, you are always allowed to cover more than one role during a journey.',
  },
  {
    name: 'Bree-Pony',
    culture: 'Bree Hobbits',
    description:
      'You have acquired an unusually brave and intelligent Bree-pony that follows you everywhere and never truly leaves your side. Raise your maximum Hope by 1; your pony has a Vigour rating of 4 regardless of your Standard of Living. (Bree-hobbits are built using the Men of Bree culture rules but Hobbit Endurance/Hope/Parry tables and weapon restrictions; per the core book\'s \'The Big and the Little\' sidebar, they must choose their six Cultural Virtues from this specific list, drawn from both the Men of Bree and Hobbits of the Shire virtue lists.)',
  },
  {
    name: 'Desperate Courage',
    culture: 'Bree Hobbits',
    description:
      'Though you have only known sheltered troubles, you are resolved to stand against the Shadow no matter the cost. When you spend Hope on a roll, you can choose to also gain 1 Shadow to become Inspired for that roll. (Bree-hobbits are built using the Men of Bree culture rules but Hobbit Endurance/Hope/Parry tables and weapon restrictions; per the core book\'s \'The Big and the Little\' sidebar, they must choose their six Cultural Virtues from this specific list, drawn from both the Men of Bree and Hobbits of the Shire virtue lists.)',
  },
  {
    name: 'Small Folk',
    culture: 'Bree Hobbits',
    description:
      'Your small stature is turned to advantage in a fight against bigger foes. Add +2 to your Parry rating when in close combat with a creature bigger than you; additionally, you may assume a Rearward stance even if only one other Company member is fighting in Close Combat stance. (Bree-hobbits are built using the Men of Bree culture rules but Hobbit Endurance/Hope/Parry tables and weapon restrictions; per the core book\'s \'The Big and the Little\' sidebar, they must choose their six Cultural Virtues from this specific list, drawn from both the Men of Bree and Hobbits of the Shire virtue lists.)',
  },
  {
    name: 'Strange as News from Bree',
    culture: 'Bree Hobbits',
    description:
      'The most inquisitive Bree-folk are always ready to gather tidings from travellers. During each Fellowship Phase, you receive a rumour from the Loremaster; while in the Bree-land, you gain a bonus Feat die on Insight and Riddle rolls. (Bree-hobbits are built using the Men of Bree culture rules but Hobbit Endurance/Hope/Parry tables and weapon restrictions; per the core book\'s \'The Big and the Little\' sidebar, they must choose their six Cultural Virtues from this specific list, drawn from both the Men of Bree and Hobbits of the Shire virtue lists.)',
  },
  {
    name: 'The Art of Smoking',
    culture: 'Bree Hobbits',
    description:
      'You have mastered the art of smoking pipe-weed, which grants you patience and clarity of mind. Whenever you regain one or more points of Hope, you recover one additional Hope point. (Bree-hobbits are built using the Men of Bree culture rules but Hobbit Endurance/Hope/Parry tables and weapon restrictions; per the core book\'s \'The Big and the Little\' sidebar, they must choose their six Cultural Virtues from this specific list, drawn from both the Men of Bree and Hobbits of the Shire virtue lists.)',
  },
  {
    name: 'Tough as Old Tree-Roots',
    culture: 'Bree Hobbits',
    description:
      'You are hard to dismay or kill, and recover your health at a remarkable pace given some peace and quiet. When Wounded and rolling to determine injury severity, roll two Feat Dice and take the better result; additionally, double your Strength score when calculating Endurance recovered while resting. (Bree-hobbits are built using the Men of Bree culture rules but Hobbit Endurance/Hope/Parry tables and weapon restrictions; per the core book\'s \'The Big and the Little\' sidebar, they must choose their six Cultural Virtues from this specific list, drawn from both the Men of Bree and Hobbits of the Shire virtue lists.)',
  },
  {
    name: 'Beorn\'s Enchantment',
    culture: 'Beornings',
    description:
      'Some say Beorn is under his own enchantment, and has extended its influence upon his folk. Choose three Strength Skills and mark them; whenever you use one of these Skills, you can spend 1 Hope to achieve a Magical success.',
  },
  {
    name: 'Brother to Bears',
    culture: 'Beornings',
    description:
      'Beorn has taught you to heed the call of your ancient animal heritage, especially in the wrath of battle. Raise your maximum Endurance by 1; you don\'t lose a Feat die on Brawling attacks, and your unarmed attacks produce a Piercing Blow on a result of the Gandalf rune, with an Injury rating of 12. Additionally, you can communicate with bears via Courtesy, Persuade, or Song rolls.',
  },
  {
    name: 'Great Strength',
    culture: 'Beornings',
    description:
      'Your physical power pushes you to favour brute force over precision when attacking. When inflicting Special Damage in combat, add +2 to your Strength rating on a Heavy Blow.',
  },
  {
    name: 'Skin-Coat',
    culture: 'Beornings',
    description:
      'It is said a warrior\'s own courage will turn steel and iron better than the smith\'s hammer-work. If you wear a suit of Leather armour or no armour at all, you gain a bonus Feat die on your Protection rolls.',
  },
  {
    name: 'Splitting Blow',
    culture: 'Beornings',
    description:
      'Your strokes are heavy enough to rend armour, a hold-over from a time when a Northman needed the strength to pierce a Dragon\'s hide. When you score a Piercing Blow on a close combat attack, the target\'s Protection roll is Ill-favoured.',
  },
  {
    name: 'Twice-Baked Honey-Cakes',
    culture: 'Beornings',
    description:
      'The honey-cakes of the Beornings are legendary among travellers, and you have been shown the secret of their making. Each time you gain Fatigue from a Journey Event, you gain 1 point less; additionally, raise your Company\'s Fellowship rating by 1 point.',
  },
  {
    name: 'Against the Unseen',
    culture: 'Elves of Mirkwood',
    description:
      'Elves can perceive creatures that dwell in the wraith-world, even when invisible to the living. You have learnt to strengthen your heart against such terrors. All your Shadow Tests due to Dread are Favoured, and you gain a bonus Feat die on those rolls forced upon you by an evil spirit or ghost (including a creature possessed by one).',
  },
  {
    name: 'Deadly Archery',
    culture: 'Elves of Mirkwood',
    description:
      'Elves possess a natural talent for hitting the mark with their bows, honed in you to near perfection. When using a Bow (not a Great Bow) while fighting in Rearward Stance, you may attempt the Prepare Shot combat task as a secondary action.',
  },
  {
    name: 'Elf-Lights',
    culture: 'Elves of Mirkwood',
    description:
      'You can make a torch or lamp burn with a magical flame capable of enchanting Mortals and humanoid creatures. Spend 1 Hope to light a torch or lamp; the Loremaster chooses a group of creatures observing the light whose total Might does not exceed your Wisdom rating, and they are drawn toward the flame. You can control the light at will, including causing it to flare and surprise onlookers; if attacked, enemies standing by the light cannot make opening volleys or act in the first Close Quarters round, and fight as if Weary for the first two rounds of combat.',
  },
  {
    name: 'Elvish Dreams',
    culture: 'Elves of Mirkwood',
    description:
      'The spirit of Elves is so strong that their bodies recover swiftly from ills and injuries, needing less and less true sleep as Wisdom grows. You don\'t need to sleep as long as you can engage in simple, repetitive activity; a Short Rest is instead treated as a Prolonged Rest.',
  },
  {
    name: 'Gleam of Wrath',
    culture: 'Elves of Mirkwood',
    description:
      'The cold, bitter hatred your kindred bear for the Enemy infuses your weapons with a gleam of chill flame. On a successful attack roll, your adversary additionally loses 1 point of Hate or Resolve, plus 1 more for each Success icon rolled.',
  },
  {
    name: 'Shots in the Dark',
    culture: 'Elves of Mirkwood',
    description:
      'For you, the dusk of night and the dark canopy of the forest are a time for merriment and feasting — but also a time you have learnt to exploit for war. When you are in a forest, or at night, you are Inspired on all your combat rolls.',
  },
  {
    name: 'A Hunter\'s Resolve',
    culture: 'Woodmen of Wilderland',
    description:
      'You have learnt to tap into the inner strength of the indefatigable and relentless hunter of Orcs and Spiders. If you are not Wounded or Miserable, you can spend 1 Hope to recover Endurance equal to your Heart or Valour score, whichever is higher.',
  },
  {
    name: 'Herbal Remedies',
    culture: 'Woodmen of Wilderland',
    description:
      'Mirkwood\'s shadowy eaves are still good for growing herbs, and you are learning the ancient craft of salves and remedies from your village elders. You gain a bonus Feat die on all Healing rolls; additionally, at the end of a journey you can roll Healing (instead of Travel) to reduce your accumulated Fatigue.',
  },
  {
    name: 'Forest Harrier',
    culture: 'Woodmen of Wilderland',
    description:
      'The Woodmen excel at forest warfare, and you have long practised their surprise tactics, always ready to strike first. Your opening volleys and close combat attacks made during the first combat round of a battle are Favoured.',
  },
  {
    name: 'Natural Watchfulness',
    culture: 'Woodmen of Wilderland',
    description:
      'You read the behaviour of animals — a bird\'s sudden silence, a beast\'s distant rustling — with uncanny precision. Whenever making an Awareness, Explore, or Scan roll, you can spend 1 Hope to achieve a Magical success; additionally, you may cover the Look-out role in addition to any other role during a journey.',
  },
  {
    name: 'Staunching Song',
    culture: 'Woodmen of Wilderland',
    description:
      'This song, taught to the worthiest of your clan since your people first travelled the Great River, reduces the loss of a warrior\'s life-blood to a trickle. Raise your maximum Hope by 1; additionally, you can roll Song (instead of Healing) to administer First Aid or save Dying heroes.',
  },
  {
    name: 'Hound of Mirkwood',
    culture: 'Woodmen of Wilderland',
    description:
      'Your folk have always delighted in training great, long-jawed hounds, stronger than wolves, and you have chosen a wolfhound of Wilderland to accompany you. When you make an Awareness or Hunting roll you gain a bonus Feat die if the hound is with you; in combat the hound counts as another Player-hero fighting in Close Combat stance, and the first close combat attack aimed at you each round loses a Feat die. If you are hit by a Piercing Blow, you can cancel it by wounding your hound instead — a wounded hound is out of combat for the rest of the scene and returns at the start of the next session on a successful Healing roll (otherwise not until the next Adventuring Phase).',
  },
];

/**
 * Cultures represented, in the order they first appear.
 *
 * DERIVED from the rows above, not typed out a second time — this is also the
 * character sheet's Culture dropdown, and a hand-maintained copy could drift
 * out of step with the Virtues it is supposed to select.
 */
export const CULTURAL_VIRTUE_CULTURES = [...new Set(CULTURAL_VIRTUES.map((v) => v.culture))];

/** Every Cultural Virtue for one culture, matched case-insensitively. */
export function culturalVirtuesFor(culture, entries = CULTURAL_VIRTUES) {
  const wanted = String(culture ?? '').trim().toLowerCase();
  if (!wanted) return [];
  return entries.filter((v) => String(v.culture).trim().toLowerCase() === wanted);
}
