// Calm, plain wording for people under stress. English is the source of truth;
// the i18n-sync Kiro hook keeps the other languages in step when en changes.
const en = {
  help: 'I NEED HELP',
  safe: "I'M SAFE",
  listen: 'START LISTENING',
  listening: 'LISTENING…',
  injured: 'Injured', trapped: 'Trapped', water: 'Water', medicine: 'Medicine', fire: 'Fire', children: 'Children', elderly: 'Elderly',
  people: 'PEOPLE',
  notePh: 'Landmark / note (optional)',
  send: 'SEND SOS',
  stop: 'STOP SENDING',
  back: '← BACK',
  inbox: 'HEARD',
  rescue: 'RESCUE',
  home: 'HOME',
  settings: 'SETTINGS',
  sosCard: 'HELP NEEDED',
  okCard: 'SAFE',
  heardYou: 'Rescuers heard you',
  onTheWay: 'ON THE WAY',
  resolved: 'RESOLVED',
  noCases: 'No calls for help heard yet. Keep this screen open: every phone nearby is a relay.',
  rescueIntro: 'Rescue Mode: every SOS you hear is answered automatically so the sender knows help is coming.',
  drill: 'DRILL (training) mode',
  drillTag: 'DRILL',
  theme: 'High-contrast theme',
  relay: 'Relay messages I hear',
  screech: 'Play classic modem screech',
  language: 'Language',
  micBlocked: 'Microphone blocked. Allow it to hear calls for help.',
  repeating: 'Repeating every 60 s until someone answers',
  peopleN: (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`,
  away: (m: string, dir: string) => `${m} ${dir}`,
  hops: (n: number) => (n === 0 ? 'direct' : `${n} hop${n > 1 ? 's' : ''}`),
};
type Dict = typeof en;

const ru: Dict = {
  help: 'НУЖНА ПОМОЩЬ', safe: 'Я В БЕЗОПАСНОСТИ', listen: 'СЛУШАТЬ ЭФИР', listening: 'СЛУШАЮ…',
  injured: 'Ранен', trapped: 'Завален', water: 'Вода', medicine: 'Лекарства', fire: 'Пожар', children: 'Дети', elderly: 'Пожилые',
  people: 'ЛЮДЕЙ', notePh: 'Ориентир / заметка (необязательно)', send: 'ОТПРАВИТЬ SOS', stop: 'ОСТАНОВИТЬ', back: '← НАЗАД',
  inbox: 'УСЛЫШАНО', rescue: 'СПАСАТЕЛЬ', home: 'ГЛАВНАЯ', settings: 'НАСТРОЙКИ', sosCard: 'НУЖНА ПОМОЩЬ', okCard: 'В БЕЗОПАСНОСТИ',
  heardYou: 'Спасатели вас услышали', onTheWay: 'ЕДЕМ', resolved: 'ПОМОГЛИ',
  noCases: 'Пока сигналов нет. Не закрывайте экран: каждый телефон рядом передаёт сообщения дальше.',
  rescueIntro: 'Режим спасателя: на каждый SOS отправляется ответ, чтобы человек знал, что помощь идёт.',
  drill: 'Учебный режим', drillTag: 'УЧЕНИЯ', theme: 'Контрастная тема', relay: 'Передавать услышанное дальше',
  screech: 'Звук классического модема', language: 'Язык', micBlocked: 'Микрофон запрещён. Разрешите, чтобы слышать сигналы.',
  repeating: 'Повтор каждые 60 с, пока не ответят',
  peopleN: (n) => `${n} чел.`, away: (m, d) => `${m} ${d}`, hops: (n) => (n === 0 ? 'напрямую' : `через ${n}`),
};
const kk: Dict = {
  help: 'КӨМЕК КЕРЕК', safe: 'МЕН АМАНМЫН', listen: 'ТЫҢДАУ', listening: 'ТЫҢДАП ЖАТЫРМЫН…',
  injured: 'Жарақат', trapped: 'Үйінді астында', water: 'Су', medicine: 'Дәрі', fire: 'Өрт', children: 'Балалар', elderly: 'Қарттар',
  people: 'АДАМ', notePh: 'Белгі / жазба (міндетті емес)', send: 'SOS ЖІБЕРУ', stop: 'ТОҚТАТУ', back: '← АРТҚА',
  inbox: 'ЕСТІЛДІ', rescue: 'ҚҰТҚАРУШЫ', home: 'БАСТЫ', settings: 'БАПТАУЛАР', sosCard: 'КӨМЕК КЕРЕК', okCard: 'АМАН',
  heardYou: 'Құтқарушылар сізді естіді', onTheWay: 'ЖОЛДАМЫЗ', resolved: 'КӨМЕКТЕСТІК',
  noCases: 'Әзірге сигнал жоқ. Экранды жаппаңыз: жақын телефондар хабарды әрі қарай жеткізеді.',
  rescueIntro: 'Құтқарушы режимі: әр SOS-қа жауап жіберіледі, адам көмек келе жатқанын біледі.',
  drill: 'Оқу-жаттығу режимі', drillTag: 'ЖАТТЫҒУ', theme: 'Контрасты тақырып', relay: 'Естігенді әрі қарай жеткізу',
  screech: 'Классикалық модем дыбысы', language: 'Тіл', micBlocked: 'Микрофонға рұқсат жоқ. Сигналдарды есту үшін рұқсат беріңіз.',
  repeating: 'Біреу жауап бергенше әр 60 с сайын қайталанады',
  peopleN: (n) => `${n} адам`, away: (m, d) => `${m} ${d}`, hops: (n) => (n === 0 ? 'тікелей' : `${n} арқылы`),
};
const es: Dict = {
  help: 'NECESITO AYUDA', safe: 'ESTOY A SALVO', listen: 'ESCUCHAR', listening: 'ESCUCHANDO…',
  injured: 'Herido', trapped: 'Atrapado', water: 'Agua', medicine: 'Medicinas', fire: 'Fuego', children: 'Niños', elderly: 'Mayores',
  people: 'PERSONAS', notePh: 'Referencia / nota (opcional)', send: 'ENVIAR SOS', stop: 'DETENER', back: '← VOLVER',
  inbox: 'ESCUCHADO', rescue: 'RESCATE', home: 'INICIO', settings: 'AJUSTES', sosCard: 'NECESITA AYUDA', okCard: 'A SALVO',
  heardYou: 'Los rescatistas te escucharon', onTheWay: 'EN CAMINO', resolved: 'RESUELTO',
  noCases: 'Aún no se han oído llamadas. Mantén esta pantalla abierta: cada teléfono cercano retransmite.',
  rescueIntro: 'Modo rescate: cada SOS recibe una respuesta para que la persona sepa que la ayuda viene.',
  drill: 'Modo simulacro', drillTag: 'SIMULACRO', theme: 'Tema de alto contraste', relay: 'Retransmitir lo que oigo',
  screech: 'Sonido clásico de módem', language: 'Idioma', micBlocked: 'Micrófono bloqueado. Permítelo para oír llamadas de ayuda.',
  repeating: 'Se repite cada 60 s hasta que alguien responda',
  peopleN: (n) => `${n} ${n === 1 ? 'persona' : 'personas'}`, away: (m, d) => `${m} ${d}`, hops: (n) => (n === 0 ? 'directo' : `${n} saltos`),
};
const tr: Dict = {
  help: 'YARDIM LAZIM', safe: 'GÜVENDEYİM', listen: 'DİNLE', listening: 'DİNLENİYOR…',
  injured: 'Yaralı', trapped: 'Enkaz altında', water: 'Su', medicine: 'İlaç', fire: 'Yangın', children: 'Çocuklar', elderly: 'Yaşlılar',
  people: 'KİŞİ', notePh: 'Yer tarifi / not (isteğe bağlı)', send: 'SOS GÖNDER', stop: 'DURDUR', back: '← GERİ',
  inbox: 'DUYULAN', rescue: 'KURTARMA', home: 'ANA SAYFA', settings: 'AYARLAR', sosCard: 'YARDIM LAZIM', okCard: 'GÜVENDE',
  heardYou: 'Kurtarma ekibi sizi duydu', onTheWay: 'YOLDAYIZ', resolved: 'ÇÖZÜLDÜ',
  noCases: 'Henüz çağrı duyulmadı. Bu ekranı açık tutun: yakındaki her telefon mesajı iletir.',
  rescueIntro: 'Kurtarma modu: her SOS otomatik yanıtlanır, gönderen yardımın geldiğini bilir.',
  drill: 'Tatbikat modu', drillTag: 'TATBİKAT', theme: 'Yüksek kontrast', relay: 'Duyduklarımı ilet',
  screech: 'Klasik modem sesi', language: 'Dil', micBlocked: 'Mikrofon engelli. Çağrıları duymak için izin verin.',
  repeating: 'Biri yanıt verene kadar her 60 sn tekrarlanır',
  peopleN: (n) => `${n} kişi`, away: (m, d) => `${m} ${d}`, hops: (n) => (n === 0 ? 'doğrudan' : `${n} aktarma`),
};
const ja: Dict = {
  help: '助けが必要', safe: '無事です', listen: '受信開始', listening: '受信中…',
  injured: 'けが', trapped: '閉じ込め', water: '水', medicine: '薬', fire: '火災', children: '子ども', elderly: '高齢者',
  people: '人数', notePh: '目印・メモ（任意）', send: 'SOSを送信', stop: '送信停止', back: '← 戻る',
  inbox: '受信', rescue: '救助', home: 'ホーム', settings: '設定', sosCard: '救助要請', okCard: '無事',
  heardYou: '救助隊に届きました', onTheWay: '向かっています', resolved: '対応済み',
  noCases: 'まだ救助要請はありません。画面を開いたままに：近くの電話が中継します。',
  rescueIntro: '救助モード：受信したSOSには自動で応答し、助けが向かっていることを伝えます。',
  drill: '訓練モード', drillTag: '訓練', theme: 'ハイコントラスト', relay: '受信した内容を中継する',
  screech: 'モデムの音を鳴らす', language: '言語', micBlocked: 'マイクが許可されていません。許可すると救助要請を受信できます。',
  repeating: '応答があるまで60秒ごとに再送',
  peopleN: (n) => `${n}人`, away: (m, d) => `${m} ${d}`, hops: (n) => (n === 0 ? '直接' : `${n}中継`),
};

export const LANGS = { en, ru, kk, es, tr, ja } as const;
export type Lang = keyof typeof LANGS;
export const LANG_NAMES: Record<Lang, string> = { en: 'English', ru: 'Русский', kk: 'Қазақша', es: 'Español', tr: 'Türkçe', ja: '日本語' };

function detect(): Lang {
  try {
    const saved = localStorage.getItem('lang') as Lang | null;
    if (saved && saved in LANGS) return saved;
  } catch { /* storage unavailable */ }
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return (nav in LANGS ? nav : 'en') as Lang;
}

let current: Lang = detect();
export const t = (): Dict => LANGS[current];
export const lang = (): Lang => current;
export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
  try { localStorage.setItem('lang', l); } catch { /* ignore */ }
}
