import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { listPrompts, savePrompt, deletePrompt, type SavedPrompt } from '@/lib/prompts';

// Docs page: two top-level sections.
//   - Knowledge Base    : w3schools-style guide for buyers. Module tabs at top,
//                         per-module TOC on the left, scrollable content on the
//                         right with prompt / note / table blocks.
//   - Prompt Bases      : admin-only (same gate as Dashboard).

type Section = 'kb' | 'prompts';

// ---------------------------------------------------------------------------
// Knowledge Base — typed content model + renderer.
// ---------------------------------------------------------------------------

type ModuleId = 'keywords' | 'angles' | 'article' | 'creatives';

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'note'; title?: string; text: string }
  | { kind: 'tip'; title?: string; text: string }
  | { kind: 'warn'; title?: string; text: string }
  | { kind: 'prompt'; label: string; model?: string; body: string }
  | { kind: 'example'; label?: string; body: string }
  | { kind: 'steps'; items: { title: string; text: string }[] }
  | { kind: 'kv'; rows: { k: string; v: string }[] }
  | { kind: 'h3'; text: string };

interface KBSection {
  id: string;
  label: string;
  blocks: Block[];
}

interface KBModule {
  id: ModuleId;
  label: string;
  tagline: string;
  sections: KBSection[];
}

// ---------- KEYWORDS module ----------

const KEYWORDS_MODULE: KBModule = {
  id: 'keywords',
  label: 'Keywords',
  tagline: 'Знайди, на які пошукові запити в обраному ринку варто гнати трафік — обсяг, CPC, тренд і AI-стратегія зверху.',
  sections: [
    {
      id: 'kw-overview',
      label: 'Огляд',
      blocks: [
        {
          kind: 'p',
          text: 'Keyword Studio відповідає на одне запитання: «у цій країні й мові, на які пошукові запити варто гнати трафік?» Ти даєш одне якірне ключове слово (anchor). Інструмент тягне реальні дані Google, ранжує нішу, обирає десять запитів для першого тесту і віддає тобі український HTML-звіт, який можна вставити в бриф.',
        },
        {
          kind: 'p',
          text: 'За кнопкою працює 6-етапний пайплайн. Тобі не треба знати, як саме він зашитий — лише порядок, щоб правильно читати звіт.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'Переклад anchor', text: 'Якщо ввімкнено — AI переписує твій anchor так, як його реально загуглила б місцева людина.' },
            { title: 'Широкий збір', text: 'DataForSEO повертає до ~100 пов\'язаних ключів з обсягом, CPC і трендом за 12 місяців.' },
            { title: 'Аналітик', text: 'Claude читає датасет, будує 3–5 кластерів, знаходить «самоцвіти» і пропонує два drill-запити для глибшого копання.' },
            { title: 'Drill-збір', text: 'Ці два drill-запити повторно тягнуться через DataForSEO — щоб аналітик побачив те, що пропустив перший прохід.' },
            { title: 'Синтезист', text: 'Другий прохід Claude обирає фінальний Top 10 і пише стратегічний наратив.' },
            { title: 'UA-звіт', text: 'Усе перекладається українською і рендериться як HTML-сторінка з картками для Top 10, самоцвітів і запропонованих anchor\'ів.' },
          ],
        },
      ],
    },
    {
      id: 'kw-inputs',
      label: 'Поля, які ти заповнюєш',
      blocks: [
        { kind: 'p', text: 'Чотири поля керують усім запуском:' },
        {
          kind: 'kv',
          rows: [
            { k: 'Anchor keyword', v: 'Стартовий запит. Одна коротка фраза, 1–3 слова. Якість запуску майже повністю залежить саме від нього.' },
            { k: 'Country (GEO)', v: 'Ринок Google, з якого тягнуться дані. CPC, обсяг і тренди повністю прив\'язані до країни.' },
            { k: 'Language', v: 'Мова ключів, які ти хочеш отримати назад. Невідповідні автоматично відсікаються.' },
            { k: 'Anchor translation', v: '«Automatic» переписує anchor на мову ринку перед збором. «None» відправляє його як є.' },
          ],
        },
        {
          kind: 'tip',
          title: 'Коли вмикати Automatic',
          text: 'Вмикай Automatic щоразу, коли друкуєш anchor своєю мовою, а результати хочеш для іноземного GEO. Залишай None лише якщо твій anchor — це вже та сама фраза, яку загуглила б місцева людина.',
        },
        {
          kind: 'warn',
          title: 'Занадто вузький anchor = порожній запуск',
          text: 'DataForSEO потрібен хоча б один ключ з обсягом ≥ 30/міс і CPC ≥ $0.30, щоб піти далі. Якщо твій anchor — бренд чи довгий хвіст — розширюй його. Замість «DealDash promo for first order» пиши «online auctions» або «penny auctions».',
        },
      ],
    },
    {
      id: 'kw-translation',
      label: 'Етап 1 — Переклад anchor',
      blocks: [
        {
          kind: 'p',
          text: 'Коли «Anchor translation» = Automatic, невеликий виклик Claude Haiku перетворює твій anchor на найприродніший локальний пошуковий запит. Та сама суть — інші слова.',
        },
        {
          kind: 'prompt',
          label: 'Anchor translator',
          model: 'Claude Haiku 4.5',
          body: `You are a search-term translator for {country} ({language}).
The operator typed an anchor in their own language. Return the most
natural {language} search term a local would google for the SAME intent.

If the input is already in {language}, return it unchanged.

Return ONLY the translated anchor as a plain string — no JSON, no
quotes, no commentary, no markdown. Just the search term.

Input anchor: {anchor}`,
        },
        {
          kind: 'note',
          title: 'Чому це важливо',
          text: 'Google ранжує запити дослівно. «loan for bad credit» і «kredyt dla zadłużonych» дають абсолютно різні SERP, навіть якщо означають одне й те саме.',
        },
      ],
    },
    {
      id: 'kw-broad',
      label: 'Етап 2 — Широкий збір',
      blocks: [
        {
          kind: 'p',
          text: '(Перекладений) anchor відправляється у DataForSEO Labs → keyword_suggestions/live. API повертає до 100 пов\'язаних ключів з обсягом, CPC (top-of-page bid) і 12-місячною історією пошуку.',
        },
        { kind: 'h3', text: 'Що ми фільтруємо' },
        {
          kind: 'list',
          items: [
            'Обсяг між 30 і 50 000 пошуків/міс — нижче 30 це шум, вище 50 000 — занадто широкий інформаційний термін, який не відіб\'є.',
            'CPC (top-of-page bid) ≥ $0.30 — дешевше не виживе навіть з 1 % CTR.',
            'Невідповідна мова відсіюється — крутиться скрипт перевірки мови + діакритики, щоб польський запуск не показував «loan near me».',
          ],
        },
        { kind: 'h3', text: 'Що ми рахуємо на кожному ключі' },
        {
          kind: 'kv',
          rows: [
            { k: 'volume', v: 'Середня кількість пошуків на місяць (DataForSEO).' },
            { k: 'cpc_low / cpc_high', v: 'Діапазон top-of-page bid у USD. cpc_high — це стеля заробітку, саме його оптимізує синтезист.' },
            { k: 'trend', v: 'Середнє за останні 3 місяці ÷ середнє за попередні 3 − 1. Додатне = росте. Усе вище +200 % — це «вибух тренду».' },
            { k: 'competition', v: 'Оцінка 0–1 від DataForSEO. Вища = більше рекламодавців уже б\'ються.' },
            { k: 'quality_score (Q)', v: 'Внутрішня оцінка, що поєднує обсяг, стелю CPC і тренд мінус конкуренція. Top-10 ранжується саме за Q.' },
          ],
        },
      ],
    },
    {
      id: 'kw-analyst',
      label: 'Етап 3 — Аналітик (Claude Opus)',
      blocks: [
        {
          kind: 'p',
          text: 'Топ-250 ключів передаються Claude Opus у ролі старшого аналітика ринку. За один прохід він робить чотири речі.',
        },
        {
          kind: 'list',
          items: [
            'Кластери — групує датасет у 3–5 тем, кожна з 1-реченням «чому цікаво».',
            'Самоцвіти (Gems) — обирає виняткові ключі у шести категоріях (нижче).',
            'Drill-запити — обирає два seed-фрази (2–4 слова), якими наступний етап повторно опитає DataForSEO.',
            'Пропоновані anchor\'и — 3–6 свіжих anchor\'ів, які варті окремого майбутнього запуску.',
          ],
        },
        { kind: 'h3', text: 'Шість категорій самоцвітів' },
        {
          kind: 'kv',
          rows: [
            { k: 'branded_surges', v: 'Бренди або назви продуктів зі зростаючим трендом.' },
            { k: 'cpc_outliers', v: 'Ключі, де cpc_high помітно вище ринкової норми.' },
            { k: 'trend_explosions', v: 'Загальні ключі з трендом > +500 % і обсягом ≥ 100.' },
            { k: 'audience_qualifiers', v: 'Демографічні маркери — «для пенсіонерів», «для студентів» тощо.' },
            { k: 'cross_cluster_magnets', v: 'Ключі, що одночасно лягають у два чи більше кластерних інтенти.' },
            { k: 'informational_funnels', v: 'Запитальні / дослідницькі запити з конкуренцією < 0.30 — дешевий трафік на верхній воронці.' },
          ],
        },
        {
          kind: 'note',
          text: 'У фінальному UA-звіті показуються лише 4 з 6 категорій: Trend Explosions, Audience Qualifiers, Cross-cluster Magnets, Informational Funnels. Інші дві лишаються всередині пайплайна — щоб синтезист міг ними скористатися, але вони б захарастили звіт.',
        },
        {
          kind: 'prompt',
          label: 'Analyst prompt (abridged)',
          model: 'Claude Opus 4.7',
          body: `You are a senior keyword market analyst for RSOC arbitrage in
{country} ({language}).

Anchor: "{anchor}"
Dataset: top N keywords by search volume from DataForSEO Labs.
Format: "keyword" vol=N/mo cpc=$LOW-$HIGH tr=PERCENT cmp=0-1

TASK 1 — CLUSTERS: 3-5 thematic clusters.
TASK 2 — GEMS:  6 categories, 3-8 picks each FROM THE DATASET.
TASK 3 — DRILL QUERIES: exactly 2 seed phrases for a follow-up sweep.
TASK 4 — SUGGESTED FOLLOW-UP ANCHORS: 3-6 seed phrases.

OUTPUT — STRICT JSON ONLY.`,
        },
      ],
    },
    {
      id: 'kw-drill',
      label: 'Етап 4 — Drill-збір',
      blocks: [
        {
          kind: 'p',
          text: 'Кожен з двох drill-запитів вирушає в DataForSEO як абсолютно новий запит keyword_suggestions/live. Усе нове домерджується в спільний датасет; дублікати дедуплятся за ключем у нижньому регістрі.',
        },
        {
          kind: 'tip',
          text: 'Drill-ключі помічаються тегом [drill] у датасеті, щоб синтезист бачив, які з його обраних взялися з глибшого збору — корисно, коли дивуєшся, чому деякі позиції з Top-10 не з\'являються у широкому списку.',
        },
      ],
    },
    {
      id: 'kw-synth',
      label: 'Етап 5 — Синтезист (Claude Opus)',
      blocks: [
        {
          kind: 'p',
          text: 'Claude Opus запускається вдруге, тепер у ролі «старшого RSOC arbitrage strategist». Він бачить вивід аналітика + топ-120 ключів за Q і видає три речі:',
        },
        {
          kind: 'list',
          items: [
            'Top 10 — десять ключів, на які витрачати в першу чергу, кожен з 1-реченням тезою, прив\'язаною до конкретних цифр обсягу / CPC / тренду.',
            'Стратегічні кластери — 2–3 названі кластери з рекомендованим % бюджету (разом = 100), EPC-tier (LOW / MED / HIGH / PREMIUM) і ключами всередині.',
            'Narrative — резюме можливості ніші у 3–4 реченнях. Це той самий блакитний блок зверху UA-звіту.',
          ],
        },
        {
          kind: 'prompt',
          label: 'Synthesist prompt (abridged)',
          model: 'Claude Opus 4.7',
          body: `You are a senior RSOC arbitrage strategist for {country} ({language}).

TASK 1 — PICK TOP 10: choose 10 maximizing EPC x CTR x volume.
        Mix head terms, trend explosions, CPC outliers, audience
        qualifiers. Each pick: 1-sentence thesis WITH CONCRETE NUMBERS.

TASK 2 — STRATEGIC CLUSTERS (2-3): each {name, rationale, priority,
        suggested_budget_pct (total=100), expected_epc_tier,
        keywords_in_cluster}.

TASK 3 — NARRATIVE: 3-4 sentences on market opportunity, key gems,
        recommended approach.

OUTPUT — STRICT JSON ONLY.`,
        },
      ],
    },
    {
      id: 'kw-output',
      label: 'Етап 6 — UA-звіт',
      blocks: [
        {
          kind: 'p',
          text: 'Фінальний прохід перекладає все українською і рендерить одну HTML-сторінку. Сторінка ділиться на картки в такому порядку:',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'Header', v: 'Run ID, країна, мова, використаний anchor.' },
            { k: 'Стратегічний наратив', v: 'Наратив від синтезиста — elevator pitch ніші.' },
            { k: 'Топ-10 ключових слів', v: 'Десять ранжованих позицій. Стовпці: rank, ключове слово (оригінал), UA-переклад, обсяг, діапазон CPC, тренд, Q. Клітинки тренду фарбуються.' },
            { k: 'Gem Hunter', v: 'Чотири категорії самоцвітів як таблиці з тими ж DFS-метриками. Branded surges і CPC outliers тут навмисно не показуються.' },
            { k: 'Рекомендовані anchors', v: 'Seed-фрази, які варті окремого наступного запуску — інша вертикаль, але близька.' },
          ],
        },
        {
          kind: 'note',
          title: 'Де живе звіт',
          text: 'HTML показується одразу у вкладці Keywords. Кожен рядок також пишеться у Data Table keyword_studio_log, щоб ти міг повертатися до старих запусків через Dashboard.',
        },
      ],
    },
    {
      id: 'kw-quality',
      label: 'Як рахується Quality Score',
      blocks: [
        {
          kind: 'p',
          text: 'Quality (Q) — проста зважена формула. Тут немає магії — вона просто дозволяє відсортувати 250 ключів, не пялячись на чотири стовпці одночасно.',
        },
        {
          kind: 'example',
          label: 'Формула',
          body: `Q = log10(volume) * 7        # volume score, more is better
  + (200<=vol<=3000 ? +4 : 0)  # sweet-spot bonus
  + min(cpc_low, 30) * 0.6   # floor CPC score
  + cpc_high tier            # 20 / 15 / 10 / 6 / 3 / 0 by ceiling
  + trend tier               # up to 25 if trend >= +500 %
  - competition * 4          # crowded markets get pushed down`,
        },
        {
          kind: 'tip',
          text: 'Q вище 50 — сильний ключ. Вище 70 — явний переможець, вартий окремого кластера.',
        },
      ],
    },
  ],
};

// ---------- ANGLES module ----------

const ANGLES_MODULE: KBModule = {
  id: 'angles',
  label: 'Angles',
  tagline: 'Перетвори один anchor на готові до запуску заголовки під кожну аудиторію — повністю відповідні рекламним політикам.',
  sections: [
    {
      id: 'an-overview',
      label: 'Огляд',
      blocks: [
        {
          kind: 'p',
          text: 'Angles — інструмент з двох кроків. Крок 1 тягне реальну видачу Google за твоїм anchor і просить AI витягнути 3–5 аудиторних сегментів. Ти обираєш ті, під які хочеш цілитись (1–5). Крок 2 генерує 6–10 заголовків на кожну аудиторію, проганяє кожен через ad-policy-перевірку і повертає топ-3 на кожну аудиторію.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'Крок 1 — Аудиторії', text: 'Anchor + GEO + Language → парсинг SERP → Audience Excavator → 3–5 сегментів на вибір.' },
            { title: 'Оператор обирає (HITL)', text: 'Ти вирішуєш, які сегменти варті бюджету. Максимум 5.' },
            { title: 'Крок 2 — Заголовки', text: 'Обрані аудиторії → 60–50 кандидатів → перевірка комплаєнсу → топ-3 на кожну аудиторію.' },
          ],
        },
        {
          kind: 'note',
          title: 'HITL — Human In The Loop',
          text: 'Пауза між Кроком 1 і Кроком 2 — навмисна. AI не обирає аудиторії за тебе — це робиш ти. Це найважливіше рішення у всьому флоу.',
        },
      ],
    },
    {
      id: 'an-inputs',
      label: 'Поля, які ти заповнюєш',
      blocks: [
        {
          kind: 'kv',
          rows: [
            { k: 'Anchor keyword', v: 'Стартовий запит — 1–3 слова. Та сама логіка, що у вкладці Keywords.' },
            { k: 'GEO', v: 'Ринок Google для парсингу SERP. «Global / Worldwide» тут навмисно прихований — він просто впав би на US.' },
            { k: 'Language', v: 'Мова, у якій повертаються аудиторії та заголовки. Заголовки додатково автоматично перекладаються українською незалежно від мови джерела.' },
            { k: 'Anchor translation', v: '«Automatic» переписує anchor на цільову мову перед парсингом SERP. «None» відправляє його як є.' },
          ],
        },
      ],
    },
    {
      id: 'an-serp',
      label: 'Крок 1.A — SERP-дослідження',
      blocks: [
        {
          kind: 'p',
          text: '(Перекладений) anchor відправляється у SearchAPI.io з engine = Google і правильним кодом країни (gl). Топ-10 органіки + AI overview + Related Searches + People Also Ask збираються в один RESEARCH-блок.',
        },
        {
          kind: 'example',
          label: 'Форма RESEARCH-блоку',
          body: `SEARCH QUERY: kredyt dla zadłużonych
GEO: Poland

TOP ORGANIC RESULTS:
1. Title — snippet (link)
2. ...

AI OVERVIEW / ANSWER BOX:
...

RELATED SEARCHES:
- pożyczka bez bik
- ...

PEOPLE ALSO ASK:
- Czy mogę dostać kredyt z komornikiem?
- ...`,
        },
        {
          kind: 'note',
          text: 'Усе, що знають наступні промти про нішу, береться з цього блоку. Реальний текст SERP → реальна лексика аудиторії → заголовки, що звучать як рідні.',
        },
      ],
    },
    {
      id: 'an-excavator',
      label: 'Крок 1.B — Audience Excavator',
      blocks: [
        {
          kind: 'p',
          text: 'Claude Sonnet читає RESEARCH-блок і видає 3–5 аудиторних сегментів. Кожне поле кожного сегмента має бути обґрунтоване SERP — жодних вигаданих сигналів, жодних знань ззовні.',
        },
        { kind: 'h3', text: 'Що містить кожен сегмент' },
        {
          kind: 'kv',
          rows: [
            { k: 'segment_id', v: 'Від «A1» до «A5» по порядку.' },
            { k: 'segment_name', v: 'Коротка маркетингова назва — «Single moms hunting first car loans».' },
            { k: 'description', v: 'Один абзац цільовою мовою.' },
            { k: 'demographics', v: 'Вік, дохід, регіон, стадія життя.' },
            { k: 'psychographics', v: 'Мотивація, страхи, цінності — «чому».' },
            { k: 'pain_points', v: 'Конкретні проблеми, які видно в SERP.' },
            { k: 'desires', v: 'Як для них виглядає «перемога».' },
            { k: 'objections', v: 'Чому вони не клікають.' },
            { k: 'vocab_to_use', v: 'Дослівні фрази, що показує SERP — справжня мова шукачів. Це золото — копірайтери дзеркалять їх.' },
          ],
        },
        {
          kind: 'prompt',
          label: 'Audience Excavator system prompt (abridged)',
          model: 'Claude Sonnet 4.6',
          body: `You are a senior performance marketing strategist specializing in
audience segmentation for RSOC headline generation.

Given a keyword, a GEO, a target language and a RESEARCH block built
from real Google SERP data, identify 3 to 5 DISTINCT marketable
audience segments suitable for separate ad creatives.

HARD RULES:
- Every audience attribute MUST be grounded in the RESEARCH block.
- Segments must be DISTINCT — no two overlap on more than 2 attributes.
- Each segment must be MARKETABLE — a copywriter could write a
  different headline for each.
- vocab_to_use must be drawn from the RESEARCH verbatim or near-verbatim.
- Output ONLY valid JSON matching the schema.`,
        },
        {
          kind: 'tip',
          title: 'Як швидко читати сегменти',
          text: 'Першим відкривай vocab_to_use. Якщо лексика чіпляє — «вони реально гуглять ЦЕ?» — бери сегмент. Якщо pain_points + vocab читаються як стіна загальних слів — пропускай.',
        },
      ],
    },
    {
      id: 'an-pick',
      label: 'Крок 2.0 — Вибір аудиторій',
      blocks: [
        {
          kind: 'p',
          text: 'Ти ставиш галочки на сегменти, на які хочеш заголовки. Мінімум 1, максимум 5. Обрані segment_id відправляються в headline-вебхук разом з тим самим RESEARCH і визначеннями аудиторій.',
        },
        {
          kind: 'warn',
          title: 'Брати все підряд — погана ідея',
          text: 'Кожна аудиторія коштує ~60 генерацій заголовків. Якщо взяти 5 слабких — реверс\'юер комплаєнсу розпорошиться, а топ-3 будуть посередніми. Бери 2–3 сегменти, від яких пре — якість б\'є охоплення.',
        },
      ],
    },
    {
      id: 'an-headlines',
      label: 'Крок 2.A — Headline Generator',
      blocks: [
        {
          kind: 'p',
          text: 'Claude Sonnet генерує 6–10 заголовків на кожну обрану аудиторію. Кожен заголовок — добуток однієї з 15 Angle Formulas на одну з 6 Hook Kernels. Звідти і береться різноманітність.',
        },
        { kind: 'h3', text: '15 Angle Formulas (ЩО говоримо)' },
        {
          kind: 'p',
          text: 'AF1–AF10 — buyer-direct (говорять до аудиторії, що хоче продукт). AF11–AF15 — broadened-scope (працюють і на випадкового читача, не лише на покупця).',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'AF1  Identity Lock', v: '[Keyword] for [Audience]' },
            { k: 'AF2  Hidden Eligibility', v: "[Audience] don't realize they qualify for [Keyword]..." },
            { k: 'AF3  Friction Removal', v: 'Get [Keyword] without [Barrier]' },
            { k: 'AF4  Comparison Frame', v: '[Keyword] for [Audience] vs general' },
            { k: 'AF5  Insider Process', v: 'How [Audience] actually get [Keyword]' },
            { k: 'AF6  Stigma Bypass', v: '[Keyword] for [Audience] — skip [shame]' },
            { k: 'AF7  Number Anchor', v: '[N] [Keyword] options for [Audience]' },
            { k: 'AF8  Authority Endorsed', v: '[Authority] [Keyword] for [Audience]' },
            { k: 'AF9  Time Window', v: '[Year] [Keyword] for [Audience]' },
            { k: 'AF10 Reverse Frame', v: 'Why [Audience] get denied [Keyword]...' },
            { k: 'AF11 System Reveal', v: 'Why [Industry] [Counter-intuitive action]...' },
            { k: 'AF12 Outrage Story', v: '[N] Things [Authority] Quietly Get Away With' },
            { k: 'AF13 Number Anchor Big', v: 'The $[Big Number] [Outcome] That Surprised...' },
            { k: 'AF14 Insider Knowledge', v: '[N] Things [Profession] Tell Family Not Clients' },
            { k: 'AF15 Time-Bomb', v: 'What to Do If [Bad Thing] Happens in 2026...' },
          ],
        },
        { kind: 'h3', text: '6 Hook Kernels (ЯК говоримо)' },
        {
          kind: 'kv',
          rows: [
            { k: 'HK1 Curiosity Gap', v: '"Discover…", "What X Don\'t Tell You", "Hidden", "What Most Miss".' },
            { k: 'HK2 Question', v: '"Are You [Audience]?", "Did You Know…?", "Why [Outcome]?"' },
            { k: 'HK3 Negative Framing', v: '"Mistakes", "Hidden Fees", "Avoid", "Warning", "Don\'t".' },
            { k: 'HK4 Comparison', v: '"X vs Y for [Audience]".' },
            { k: 'HK5 Time Pressure', v: '"2026 Update", "Before [Date]", "Just Changed".' },
            { k: 'HK6 Identity Stack', v: 'Стек з 2–3 фільтрів аудиторії — "Single Mums on Universal Credit Looking for First Car".' },
          ],
        },
        { kind: 'h3', text: 'Жорсткі правила, які має пройти кожен заголовок' },
        {
          kind: 'list',
          items: [
            'Довжина 50–90 символів (CJK-символи рахуються як 2 → ціль 25–45).',
            'Anchor-ключ має з\'явитися у кожному заголовку (або дуже близький синонім).',
            'Аудиторія має бути названа чи опосередковано вказана.',
            'Жодних «!!», жодних «?!», максимум одне «:» на заголовок.',
            'Мова джерела має співпадати з GEO. Український переклад надається завжди.',
            '40–60 % виводу — broadened-scope (AF11–AF15).',
            'По всьому батчу: щонайменше 3 різних AF-коди І щонайменше 3 різних HK-коди.',
          ],
        },
        {
          kind: 'warn',
          title: 'Заборонені фрази (авто-реджект)',
          text: '«100 % compensation», «guaranteed million», «free money», «government will pay», «they don\'t want you to know», «shocking truth», «one weird trick» і подібне. Заголовок реджектиться, навіть якщо все інше ідеальне.',
        },
      ],
    },
    {
      id: 'an-compliance',
      label: 'Крок 2.B — Compliance Agent',
      blocks: [
        {
          kind: 'p',
          text: 'Кожен заголовок-кандидат проходить через окремий прохід Claude Sonnet у ролі реверс\'юера ad-policy (Meta Ads, Google Ads, FTC, регіональні стандарти). Він видає по одному вердикту на заголовок — compliant true/false, коротка причина, severity.',
        },
        { kind: 'h3', text: 'Що позначається non-compliant' },
        {
          kind: 'list',
          items: [
            'Необґрунтовані абсолюти — «guaranteed», «100 %», «instant», «risk-free».',
            'Фальшива терміновість — «today only», «24 hours left», коли реального дедлайну немає.',
            'Meta personal-attributes — натяки на расу, релігію, стан здоров\'я, фінансові проблеми, кримінальне минуле.',
            'Натяк на офіційну підтримку, якої немає — «government will pay you».',
            'Конспірологія / фрейм обурення — «they don\'t want you to know», «banks hate this».',
            'Обманні фінансові / медичні результати — гарантовані виплати, claim\'и на лікування.',
            'Хижий фрейм щодо вразливих груп (пенсіонери, люди з боргами, нещодавно осиротілі).',
            'Лайка, образи, сексуальний контент, насильство, дискримінаційна мова.',
          ],
        },
        {
          kind: 'tip',
          text: 'Нейтральне називання професії чи стадії життя — «for retirees», «for first-time buyers» — це compliant. Межа проходить між «назвати» і «використати».',
        },
      ],
    },
    {
      id: 'an-validate',
      label: 'Крок 2.C — Механічні перевірки',
      blocks: [
        {
          kind: 'p',
          text: 'Перш ніж кандидати потраплять до наступного AI, маленький код-крок повторно перевіряє їх проти жорстких правил вище і помічає всі з механічними порушеннями (не та довжина, заборонена фраза, відсутній ключ). Вердикт комплаєнсу з попереднього кроку причіплюється до кожного кандидата.',
        },
      ],
    },
    {
      id: 'an-toppick',
      label: 'Крок 2.D — Top-Pick Selection',
      blocks: [
        {
          kind: 'p',
          text: 'Фінальний прохід Claude Sonnet діє як старший копірайтер direct-response. Він не пише нові заголовки — він курирує. На кожну обрану аудиторію повертає 3 найкращі кандидати, ранжовані.',
        },
        { kind: 'h3', text: 'Як обирається топ-3 (порядок пріоритету)' },
        {
          kind: 'list',
          items: [
            'Комплаєнс — жорсткий гейт. Будь-який кандидат з compliance_ok = false чи has_violations = true пропускається, ніколи не береться навіть як fallback.',
            'Присутність ключа — anchor-ключ має реально бути в заголовку.',
            'Audience fit — звертається до pain_points / desires / vocab саме цього сегмента.',
            'Diversity within 3 — три різних AF-коди І три різних HK-коди, якщо можливо.',
            'Scope balance — щонайменше один buyer-direct + щонайменше один broadened, якщо обидва доступні.',
            'Click-worthiness — чи реальна людина з цього сегмента справді клікне у стрічці?',
          ],
        },
        {
          kind: 'note',
          title: 'Що означає rank',
          text: 'Rank 1 = найсильніший, забирає найбільший бюджет. Rank 2 = міцний B-варіант. Rank 3 = надійний backup. Якщо у сегменті менше 3 валідних кандидатів — у відповіді є fallback_note, що пояснює чому.',
        },
      ],
    },
    {
      id: 'an-output',
      label: 'Як читати заголовки',
      blocks: [
        {
          kind: 'p',
          text: 'Фінальна таблиця показує кожен топ-3 заголовок з його angle formula, hook kernel, самим текстом і українським перекладом. Заголовки згруповані за аудиторією і відсортовані за рангом.',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'audience', v: 'ID сегмента і назва — «A2 · Single moms in PA».' },
            { k: 'angle_formula', v: 'Який AF-код задав структуру (AF1–AF15).' },
            { k: 'headline_kernel', v: 'Який HK-код задав тон (HK1–HK6).' },
            { k: 'headline', v: 'Сам заголовок цільовою мовою.' },
            { k: 'translation_ua', v: 'Український ідіоматичний переклад.' },
            { k: 'rank', v: '1 = основний, 2 = вторинний, 3 = fallback.' },
          ],
        },
      ],
    },
  ],
};

// ---------- Article + Creatives — short placeholders for now ----------

const ARTICLE_MODULE: KBModule = {
  id: 'article',
  label: 'Article',
  tagline: 'Переписування статті з прив\'язкою до SERP — у тому стилі і довжині, які ти обираєш.',
  sections: [
    {
      id: 'ar-soon',
      label: 'Незабаром',
      blocks: [
        {
          kind: 'note',
          title: 'У роботі',
          text: 'Повна документація по Article вийде наступним проходом. Коротко: ти обираєш тему, GEO, мову і режим письма. Воркфлоу парсить топ-10 SERP і переписує його у статтю обраного стилю.',
        },
      ],
    },
  ],
};

const CREATIVES_MODULE: KBModule = {
  id: 'creatives',
  label: 'Creatives',
  tagline: 'Angles → концепти → батчі банерних варіантів.',
  sections: [
    {
      id: 'cr-soon',
      label: 'Незабаром',
      blocks: [
        {
          kind: 'note',
          title: 'У роботі',
          text: 'Повна документація по Creatives вийде наступним проходом. Коротко: чотири колонки — input, angles, concepts, batches. Заповнюєш форму, генеруєш angles, обираєш одну, щоб розгорнути її в концепти, потім кожен концепт перетворюється в батч банерних варіантів.',
        },
      ],
    },
  ],
};

const MODULES: KBModule[] = [KEYWORDS_MODULE, ANGLES_MODULE, ARTICLE_MODULE, CREATIVES_MODULE];

// ---------------------------------------------------------------------------
// Renderer for a single block.
// ---------------------------------------------------------------------------

const BlockView = ({ block }: { block: Block }) => {
  switch (block.kind) {
    case 'p':
      return <p className="text-[15px] text-slate-700 leading-relaxed">{block.text}</p>;
    case 'h3':
      return (
        <h3 className="text-base font-bold text-slate-900 mt-2 pb-1 border-b border-slate-200">
          {block.text}
        </h3>
      );
    case 'list':
      return (
        <ul className="list-disc pl-6 space-y-1.5 text-[15px] text-slate-700 leading-relaxed">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      );
    case 'note':
      return (
        <div className="rounded-lg border-l-4 border-blue-400 bg-blue-50/70 p-4">
          {block.title && (
            <div className="text-xs font-bold uppercase tracking-wide text-blue-700 mb-1">
              Примітка · {block.title}
            </div>
          )}
          {!block.title && (
            <div className="text-xs font-bold uppercase tracking-wide text-blue-700 mb-1">
              Примітка
            </div>
          )}
          <p className="text-[14px] text-slate-800 leading-relaxed">{block.text}</p>
        </div>
      );
    case 'tip':
      return (
        <div className="rounded-lg border-l-4 border-green-500 bg-green-50/70 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-green-700 mb-1">
            Порада{block.title ? ` · ${block.title}` : ''}
          </div>
          <p className="text-[14px] text-slate-800 leading-relaxed">{block.text}</p>
        </div>
      );
    case 'warn':
      return (
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50/70 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-1">
            Увага{block.title ? ` · ${block.title}` : ''}
          </div>
          <p className="text-[14px] text-slate-800 leading-relaxed">{block.text}</p>
        </div>
      );
    case 'prompt':
      return (
        <div className="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-300">
              Prompt · {block.label}
            </span>
            {block.model && (
              <span className="text-[11px] font-mono text-emerald-300">{block.model}</span>
            )}
          </div>
          <pre className="px-4 py-3 text-[12.5px] leading-relaxed text-slate-100 font-mono whitespace-pre-wrap overflow-x-auto">
            {block.body}
          </pre>
        </div>
      );
    case 'example':
      return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
          {block.label && (
            <div className="px-4 py-1.5 bg-slate-100 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wide text-slate-600">
              {block.label}
            </div>
          )}
          <pre className="px-4 py-3 text-[12.5px] leading-relaxed text-slate-800 font-mono whitespace-pre-wrap overflow-x-auto">
            {block.body}
          </pre>
        </div>
      );
    case 'steps':
      return (
        <ol className="space-y-2">
          {block.items.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center">
                {i + 1}
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">{s.title}</div>
                <div className="text-[14px] text-slate-700 leading-relaxed">{s.text}</div>
              </div>
            </li>
          ))}
        </ol>
      );
    case 'kv':
      return (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-[14px]">
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="px-3 py-2 align-top w-[28%] font-mono text-[12.5px] text-slate-900 font-semibold border-r border-slate-200">
                    {r.k}
                  </td>
                  <td className="px-3 py-2 align-top text-slate-700 leading-relaxed">{r.v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
};

// ---------------------------------------------------------------------------
// KnowledgeBaseView — top module tabs + left TOC + scrollable content.
// ---------------------------------------------------------------------------

const KnowledgeBaseView = () => {
  const [moduleId, setModuleId] = useState<ModuleId>('keywords');
  const [activeSection, setActiveSection] = useState<string>('');
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const mod = useMemo(
    () => MODULES.find((m) => m.id === moduleId) ?? MODULES[0],
    [moduleId],
  );

  // Reset scroll + active section when switching modules.
  useEffect(() => {
    sectionRefs.current = {};
    setActiveSection(mod.sections[0]?.id ?? '');
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [moduleId, mod.sections]);

  // Active section follows the scroll position — highlight the section whose
  // top has crossed the upper third of the content viewport.
  useEffect(() => {
    const scroller = contentRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const top = scroller.getBoundingClientRect().top;
      const threshold = top + 120;
      let current = mod.sections[0]?.id ?? '';
      for (const s of mod.sections) {
        const el = sectionRefs.current[s.id];
        if (!el) continue;
        const elTop = el.getBoundingClientRect().top;
        if (elTop <= threshold) current = s.id;
      }
      setActiveSection(current);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [mod.sections]);

  const scrollToSection = (id: string) => {
    const el = sectionRefs.current[id];
    const scroller = contentRef.current;
    if (!el || !scroller) return;
    // Distance from the section's top to the scroller's top, normalized into
    // scroller-space. offsetTop walks to the nearest positioned ancestor and
    // is unreliable here because the scroller's inner wrappers aren't
    // position:relative — bounding rects give us the exact pixel offset.
    const top =
      el.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top
      + scroller.scrollTop
      - 16;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-hidden">
      {/* Module tab nav — same look as the Dashboard sub-tabs. */}
      <div className="bg-white rounded-xl border p-2 shadow-sm flex items-center gap-1 shrink-0 overflow-x-auto">
        {MODULES.map((m) => {
          const isActive = m.id === moduleId;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setModuleId(m.id)}
              className={`rounded px-3 py-1.5 text-sm transition-colors whitespace-nowrap ${
                isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Two-pane: TOC + content. */}
      <div className="flex-1 min-h-0 flex gap-4 overflow-hidden">
        {/* TOC */}
        <aside className="hidden md:flex w-60 shrink-0 bg-white rounded-xl border shadow-sm overflow-y-auto flex-col">
          <div className="px-4 py-3 border-b sticky top-0 bg-white">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              На цій сторінці
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">{mod.label}</div>
          </div>
          <nav className="p-2 flex flex-col">
            {mod.sections.map((s) => {
              const isActive = s.id === activeSection;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => scrollToSection(s.id)}
                  className={`text-left text-[13px] rounded px-3 py-1.5 transition-colors ${
                    isActive
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div
          ref={contentRef}
          className="flex-1 min-w-0 bg-white rounded-xl border shadow-sm overflow-y-auto"
        >
          <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 space-y-10">
            {/* Module header */}
            <header>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Knowledge Base
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mt-1">{mod.label}</h1>
              <p className="text-[15px] text-slate-600 mt-1.5 leading-relaxed">{mod.tagline}</p>
            </header>

            {/* Sections */}
            {mod.sections.map((s) => (
              <section
                key={s.id}
                ref={(el) => {
                  sectionRefs.current[s.id] = el;
                }}
                className="scroll-mt-4"
              >
                <h2 className="text-xl font-bold text-slate-900 pb-2 border-b-2 border-slate-900">
                  {s.label}
                </h2>
                <div className="mt-4 space-y-4">
                  {s.blocks.map((b, i) => (
                    <BlockView key={i} block={b} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Prompt Bases — admin-only. Backed by the DEV Prompt Bases n8n workflow so
// every admin sees the same shared library. List fetches on mount; save/delete
// roundtrip to the API and reuse the response (no extra refetch).
// ---------------------------------------------------------------------------

type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

const humanizeError = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
};

const PromptBasesView = () => {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('idle');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftBody, setDraftBody] = useState('');
  // Free-form Ukrainian summary that ends up in Column3's (i) tooltip. Optional
  // — empty drafts still save fine, the tooltip just falls back to the prompt
  // body when ua_description is missing.
  const [draftUaDescription, setDraftUaDescription] = useState('');
  // id can be a string or a number — n8n's Data Table auto-id is integer, but
  // the API surface accepts both. Track whichever we got back from the server.
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  // Sidebar search — case-insensitive substring on the name. Empty query shows
  // everything. UX matches the GEO / Language comboboxes in Creatives.
  const [searchQuery, setSearchQuery] = useState('');

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFetchStatus('loading');
      setFetchError(null);
      try {
        const list = await listPrompts();
        if (cancelled) return;
        setPrompts(list);
        setFetchStatus('success');
      } catch (e) {
        if (cancelled) return;
        setFetchStatus('error');
        setFetchError(humanizeError(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const resetForm = () => {
    setDraftName('');
    setDraftBody('');
    setDraftUaDescription('');
    setEditingId(null);
    setOpError(null);
  };

  const handleSave = async () => {
    const name = draftName.trim();
    const body = draftBody;
    if (!name || !body.trim()) return;
    setBusy('saving');
    setOpError(null);
    try {
      const saved = await savePrompt({
        id: editingId ?? undefined,
        name,
        prompt: body,
        ua_description: draftUaDescription,
      });
      setPrompts((cur) => {
        const idx = cur.findIndex((p) => p.id === saved.id);
        if (idx === -1) return [saved, ...cur];
        const next = cur.slice();
        next[idx] = saved;
        return next;
      });
      resetForm();
    } catch (e) {
      setOpError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  };

  const handleEdit = (p: SavedPrompt) => {
    setEditingId(p.id);
    setDraftName(p.name);
    setDraftBody(p.prompt);
    setDraftUaDescription(p.ua_description ?? '');
    setOpError(null);
  };

  const handleDelete = async (id: string | number) => {
    setBusy('deleting');
    setOpError(null);
    try {
      await deletePrompt(id);
      setPrompts((cur) => cur.filter((p) => p.id !== id));
      if (editingId === id) resetForm();
    } catch (e) {
      setOpError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  };

  const canSave = draftName.trim().length > 0 && draftBody.trim().length > 0 && busy === null;

  return (
    <div className="flex h-full w-full gap-4 overflow-hidden">
      {(() => {
        // Filtered view of the library. Empty query is the full list. Match is
        // case-insensitive substring on the name (same shape as the GEO /
        // Language comboboxes elsewhere in the app).
        const trimmedQuery = searchQuery.trim().toLowerCase();
        const filteredPrompts = trimmedQuery
          ? prompts.filter((p) => p.name.toLowerCase().includes(trimmedQuery))
          : prompts;
        return (
          <>
      {/* Sidebar list */}
      <aside className="w-72 shrink-0 bg-white rounded-xl border shadow-sm overflow-y-auto flex flex-col">
        <div className="p-3 border-b sticky top-0 bg-white z-10 space-y-2">
          <div>
            <h3 className="font-bold text-sm">Saved prompts</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {fetchStatus === 'loading' && 'loading…'}
              {fetchStatus === 'error' && <span className="text-red-600">load failed</span>}
              {fetchStatus === 'success' && (
                trimmedQuery
                  ? `${filteredPrompts.length} of ${prompts.length} match`
                  : `${prompts.length} shared with the team`
              )}
            </p>
          </div>
          {prompts.length > 0 && (
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name…"
              className="w-full text-xs border rounded-md px-2 py-1.5 bg-white"
            />
          )}
        </div>
        {fetchStatus === 'error' && fetchError && (
          <div className="p-3 text-xs text-red-600 whitespace-pre-wrap">{fetchError}</div>
        )}
        {fetchStatus === 'success' && prompts.length === 0 && (
          <div className="p-3 text-xs text-slate-400 italic">
            No prompts yet. Use the form to add the first one.
          </div>
        )}
        {prompts.length > 0 && filteredPrompts.length === 0 && (
          <div className="p-3 text-xs text-slate-400 italic">
            No prompts match “{searchQuery.trim()}”.
          </div>
        )}
        {filteredPrompts.length > 0 && (
          <ul className="divide-y">
            {filteredPrompts.map((p) => {
              const isEditing = p.id === editingId;
              return (
                <li
                  key={p.id}
                  className={`p-3 transition-colors ${
                    isEditing ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="font-semibold text-sm truncate" title={p.name}>
                    {p.name}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 line-clamp-2 whitespace-pre-wrap">
                    {p.prompt}
                  </div>
                  {p.updated_by && (
                    <div className="text-[10px] text-slate-400 mt-1 font-mono truncate" title={`${p.updated_by} · ${p.updated_at ?? ''}`}>
                      {p.updated_by}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(p)}
                      disabled={busy !== null}
                      className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      Edit
                    </button>
                    <span className="text-xs text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      disabled={busy !== null}
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Form */}
      <div className="flex-1 bg-white rounded-xl border shadow-sm p-4 overflow-y-auto flex flex-col">
        <h3 className="font-bold text-sm mb-3">
          {editingId ? 'Edit prompt' : 'New prompt'}
        </h3>

        <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
          Name
        </label>
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="A short identifier — e.g. Process stage hook"
          className="mb-4"
          disabled={busy !== null}
        />

        <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
          Custom prompt
        </label>
        <Textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          placeholder="Write the full prompt body here…"
          rows={14}
          className="font-mono text-sm flex-1 min-h-[260px] mb-4"
          disabled={busy !== null}
        />

        <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
          UA description{' '}
          <span className="ml-1 normal-case font-normal text-slate-400">
            — optional, shown in the (i) tooltip in Concepts → Image presets
          </span>
        </label>
        <Textarea
          value={draftUaDescription}
          onChange={(e) => setDraftUaDescription(e.target.value)}
          placeholder="Короткий опис українською — що цей промт робить, коли його обирати…"
          rows={4}
          className="text-sm min-h-[80px] mb-4"
          disabled={busy !== null}
        />

        {opError && (
          <div className="text-xs text-red-600 mb-3 whitespace-pre-wrap" role="alert">
            {opError}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          {editingId && (
            <Button variant="outline" size="sm" onClick={resetForm} disabled={busy !== null}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {busy === 'saving'
              ? 'Saving…'
              : editingId ? 'Update' : 'Save'}
          </Button>
        </div>
      </div>
          </>
        );
      })()}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Top-level Docs page.
// ---------------------------------------------------------------------------

interface DocsPageProps {
  isAdmin: boolean;
}

export const DocsPage = ({ isAdmin }: DocsPageProps) => {
  // If a non-admin lands here we just default to the only section they can see.
  const [section, setSection] = useState<Section>('kb');

  return (
    <div className="flex h-full w-full flex-col gap-4 p-4 bg-slate-100 overflow-hidden">
      {/* Top-level section nav — mirrors the Dashboard's sub-tab look. */}
      <div className="bg-white rounded-xl border p-2 shadow-sm flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setSection('kb')}
          className={`rounded px-3 py-1.5 text-sm transition-colors ${
            section === 'kb'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
          aria-current={section === 'kb' ? 'page' : undefined}
        >
          Knowledge Base
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setSection('prompts')}
            className={`rounded px-3 py-1.5 text-sm transition-colors ${
              section === 'prompts'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
            aria-current={section === 'prompts' ? 'page' : undefined}
          >
            Prompts Base
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {section === 'kb' && <KnowledgeBaseView />}
        {section === 'prompts' && isAdmin && <PromptBasesView />}
      </div>
    </div>
  );
};
