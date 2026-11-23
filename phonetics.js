/**
 * Approximate English-friendly respelling of German text
 * so English speakers can pronounce it without IPA.
 */

const DIGRAPH_RULES = [
  [/tsch/gi, "ch"],
  [/sch/gi, "sh"],
  [/tsch/gi, "ch"],
  [/ch(?=[eéií])/gi, "kh"],
  [/ch/gi, "kh"],
  [/ck/gi, "k"],
  [/tz/gi, "ts"],
  [/pf/gi, "pf"],
  [/ph/gi, "f"],
  [/qu/gi, "kv"],
  [/th/gi, "t"],
  [/sp(?=[aouäöü])/gi, "shp"],
  [/st(?=[aouäöü])/gi, "sht"],
  [/sp/gi, "shp"],
  [/st/gi, "sht"],
  [/ei/gi, "eye"],
  [/ie/gi, "ee"],
  [/eu/gi, "oy"],
  [/äu/gi, "oy"],
  [/au/gi, "ow"],
  [/ai/gi, "eye"],
  [/ay/gi, "eye"],
  [/aa/gi, "ah"],
  [/ee/gi, "ay"],
  [/oo/gi, "oh"],
  [/äh/gi, "eh"],
  [/öh/gi, "ur"],
  [/üh/gi, "ue"],
  [/ah/gi, "ah"],
  [/eh/gi, "ay"],
  [/ih/gi, "ee"],
  [/oh/gi, "oh"],
  [/uh/gi, "oo"],
];

const SINGLE_RULES = [
  [/ß/g, "ss"],
  [/ä/gi, "eh"],
  [/ö/gi, "ur"],
  [/ü/gi, "ue"],
  [/j/gi, "y"],
  [/v/gi, "f"],
  [/w/gi, "v"],
  [/z/gi, "ts"],
  [/x/gi, "ks"],
  [/c(?=[eéiíy])/gi, "ts"],
  [/c/gi, "k"],
  [/g(?=$|[^a-zäöü])/gi, "k"],
  [/s(?=[aouäöü])/gi, "z"],
];

const WORD_OVERRIDES = {
  ich: "ikh",
  du: "doo",
  er: "air",
  sie: "zee",
  es: "ess",
  wir: "veer",
  ihr: "eer",
  uns: "oons",
  euch: "oykh",
  mein: "mine",
  dein: "dine",
  sein: "zine",
  unser: "OON-zer",
  euer: "OY-er",
  ja: "yah",
  nein: "nine",
  bitte: "BIT-tuh",
  danke: "DAHN-kuh",
  hallo: "HAH-loh",
  guten: "GOO-ten",
  tag: "tahk",
  morgen: "MOR-gen",
  abend: "AH-bent",
  nacht: "nahkht",
  wie: "vee",
  geht: "gayt",
  gehts: "gayts",
  "geht's": "gayts",
  ihnen: "EEN-en",
  entschuldigung: "ent-SHOOL-di-goong",
  wo: "voh",
  was: "vahs",
  wer: "vair",
  warum: "vah-ROOM",
  weil: "vile",
  und: "oont",
  oder: "OH-der",
  aber: "AH-ber",
  nicht: "nikht",
  kein: "kine",
  keine: "KYE-nuh",
  mit: "mit",
  ohne: "OH-nuh",
  für: "fuer",
  von: "fon",
  nach: "nahkh",
  bei: "bye",
  zu: "tsoo",
  zum: "tsoom",
  zur: "tsoor",
  auf: "owf",
  aus: "ows",
  ein: "ine",
  eine: "EYE-nuh",
  einen: "EYE-nen",
  der: "dair",
  die: "dee",
  das: "dahs",
  den: "den",
  dem: "dem",
  des: "dess",
  ist: "ist",
  sind: "zint",
  habe: "HAH-buh",
  haben: "HAH-ben",
  bin: "bin",
  bist: "bist",
  gut: "goot",
  schön: "shurn",
  schoen: "shurn",
  freut: "froyt",
  mich: "mikh",
  dich: "dikh",
  name: "NAH-muh",
  heiße: "HYE-suh",
  heisse: "HYE-suh",
  heißt: "hyst",
  heisst: "hyst",
  sprechen: "SHPREH-khen",
  deutsch: "doytch",
  englisch: "ENG-lish",
  wasser: "VAH-ser",
  brot: "broht",
  käse: "KAY-zuh",
  kaese: "KAY-zuh",
  milch: "milkh",
  bier: "beer",
  wein: "vine",
  toilette: "toy-LET-uh",
  bahnhof: "BAHN-hohf",
  flughafen: "FLOOK-hah-fen",
  hilfe: "HIL-fuh",
  notarzt: "NOTE-artst",
  polizei: "po-li-TSYE",
  rechnung: "REKH-noong",
  zahlen: "TSAH-len",
  speisekarte: "SHPYE-zuh-kar-tuh",
};

function capitalizePhonetic(word) {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function syllabifyHint(token) {
  // Light hyphenation for long respellings to aid reading.
  if (token.includes("-") || token.length < 7) return token;
  return token
    .replace(/([aeiouy]{1,2})([^aeiouy\-]{1,2})(?=[aeiouy])/gi, "$1$2-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function respellToken(raw) {
  const punctMatch = raw.match(/^([^A-Za-zÄÖÜäöüß]*)(.*?)([^A-Za-zÄÖÜäöüß]*)$/);
  if (!punctMatch) return raw;
  const [, lead, core, trail] = punctMatch;
  if (!core) return raw;

  const key = core.toLowerCase();
  if (WORD_OVERRIDES[key]) {
    const override = WORD_OVERRIDES[key];
    const cased =
      core[0] === core[0].toUpperCase() ? capitalizePhonetic(override) : override;
    return `${lead}${cased}${trail}`;
  }

  let out = core;
  for (const [re, rep] of DIGRAPH_RULES) {
    out = out.replace(re, rep);
  }
  for (const [re, rep] of SINGLE_RULES) {
    out = out.replace(re, rep);
  }

  out = out.replace(/q/gi, "k");
  out = syllabifyHint(out.toLowerCase());

  if (core[0] === core[0].toUpperCase()) {
    out = capitalizePhonetic(out);
  }
  return `${lead}${out}${trail}`;
}

export function germanToEnglishPhonetic(germanText) {
  if (!germanText || !germanText.trim()) return "";
  return germanText
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : respellToken(part)))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
