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

type ModuleId = 'keywords' | 'angles' | 'article' | 'creatives' | 'creative-gen' | 'creative-edit' | 'creative-edit-approach' | 'fb-to-nb';

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

// ---------- ARTICLE module ----------

const ARTICLE_MODULE: KBModule = {
  id: 'article',
  label: 'Article',
  tagline: 'Лендінг-стаття під RSOC — топ-10 Google переписується у твоєму режимі (Teaser / Balanced / Detailed) і повертається готовою HTML-сторінкою.',
  sections: [
    {
      id: 'ar-overview',
      label: 'Огляд',
      blocks: [
        {
          kind: 'p',
          text: 'Article — інструмент під RSOC-арбітраж (Related Search on Content). Ти даєш тему, GEO і мову. Бекенд паралельно парсить топ-10 видачі Google, чистить кожну сторінку у фактологічний дайджест, а потім переписує все в нову статтю — у тому режимі, який ти обрав. На виході — готова HTML-сторінка, яку можна одразу віддати під лендінг із Related Searches.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'SERP-збір', text: 'SearchAPI.io тягне топ-10 органіки під твій GEO.' },
            { title: 'Jina-парсинг', text: 'Кожна стаття з топ-10 пропускається через r.jina.ai — отримуємо чистий текст без меню, реклами і футерів.' },
            { title: 'Research digest', text: 'GPT-5.1 у ролі дослідницького аналітика стискає кожну сторінку у ~250–350 слів фактів, цифр, діапазонів, термінології. Сміття викидається.' },
            { title: 'Aggregate', text: 'Усі дайджести зливаються в один research-блок — це сировина для письма.' },
            { title: 'Генерація статті', text: 'GPT-5.1 пише статтю в одному з трьох режимів: Teaser, Balanced або Detailed. Формат жорсткий: 16 рядків (h1, p1, h2, p2, …, h8, p8).' },
            { title: 'Convert to HTML', text: 'Код розбирає 16 рядків у HTML-сторінку зі стилями (карточний layout, типографіка, breakpoints).' },
          ],
        },
        {
          kind: 'note',
          title: 'RSOC — як це монетизується',
          text: 'Стаття — це лендінг під платний трафік. Прямо після вступу (між p1 і першими секціями) сидить блок Related Searches. Гроші капають, коли користувач клікає по одному з ключів у цьому блоці. Завдання статті — підтвердити, що тема реальна, дати достатньо субстанції, але не закрити персональне питання читача — інакше клікати немає сенсу.',
        },
      ],
    },
    {
      id: 'ar-inputs',
      label: 'Поля, які ти заповнюєш',
      blocks: [
        {
          kind: 'kv',
          rows: [
            { k: 'Article topic', v: 'Тема статті. Може бути ключем (anchor) або повним заголовком. Жорстке правило: якщо тема має 5+ слів, вона стає h1 ДОСЛІВНО (символ у символ). Менше 5 слів — модель легенько розширює, не викидаючи жодного слова.' },
            { k: 'GEO', v: 'Ринок, під який пишемо. GEO впливає одразу на дві речі: gl-параметр у SearchAPI (видача, специфічна для країни) і регіональні норми у самій статті (валюта, термінологія, регулятори, ідіоми).' },
            { k: 'Language', v: 'Мова статті. Жорстко контролюється: жодних домішок з інших варіантів локалі (наприклад, кастильські форми в латиноамериканській іспанській — заборонені).' },
            { k: 'Mode (1 / 2 / 3)', v: '1 = Balanced, 2 = Teaser, 3 = Detailed. Це різні промти з різними стратегіями утримування читача. Деталі — нижче.' },
          ],
        },
      ],
    },
    {
      id: 'ar-serp',
      label: 'Етап 1 — SERP top-10',
      blocks: [
        {
          kind: 'p',
          text: 'Тема відправляється у SearchAPI.io з engine = google і кодом країни, витягнутим з GEO. Беремо перші 10 органічних результатів — це і є наша сировина для аналізу.',
        },
        {
          kind: 'tip',
          text: 'Чим точніше тема відповідає інтенту RSOC-ключа, тим релевантніший топ-10 — і тим краща стаття на виході. Розмиті теми (на кшталт «фінанси») дають загальний топ і слабкий research digest.',
        },
      ],
    },
    {
      id: 'ar-jina',
      label: 'Етап 2 — Jina-парсинг',
      blocks: [
        {
          kind: 'p',
          text: 'Кожне посилання з топ-10 пропускається через r.jina.ai — публічний сервіс, який витягає чистий текстовий контент сторінки. Меню, шапки, футери, банери, віджети «Related articles» — все це відсікається на цьому етапі.',
        },
        {
          kind: 'note',
          text: 'Якщо одна зі сторінок не парситься (paywall, JS-only render тощо) — вона тихо пропускається, без падіння пайплайна.',
        },
      ],
    },
    {
      id: 'ar-clean',
      label: 'Етап 3 — Research digest',
      blocks: [
        {
          kind: 'p',
          text: 'Кожен спарсений текст окремо проходить через GPT-5.1, який працює як research analyst. Завдання — витиснути з тексту все, що робить майбутню статтю фактологічною: цифри, діапазони, порівняння, механіку, термінологію. Усе інше — викидаємо.',
        },
        { kind: 'h3', text: 'Що зберігається' },
        {
          kind: 'list',
          items: [
            'Конкретні факти, цифри, відсотки, типові діапазони (цін, ставок, термінів, вікових порогів).',
            'Порівняння між опціями / підходами і трейд-офи, що їх розрізняють.',
            'Механіка — як це реально працює, кроки, умови, шаблони допуску.',
            'Категорії і типи, які існують всередині теми.',
            'Нативна термінологія ніші (TAEG, FICO, HUD, Section 202, CRIF тощо).',
            'Усе несподіване, контрінтуїтивне, що зазвичай неправильно розуміють.',
          ],
        },
        { kind: 'h3', text: 'Що відсівається як сміття' },
        {
          kind: 'list',
          items: [
            'Навігація, футери, cookie-нотиси, реклама, автор-біо, коментарі.',
            'Чиста промо-копія і CTA.',
            'Boilerplate, не пов\'язаний з темою.',
          ],
        },
        {
          kind: 'prompt',
          label: 'Clean data prompt',
          model: 'GPT-5.1',
          body: `You are a research analyst preparing source material for a writer.

Topic: "{Article topic}".

Read the website text below and pull out everything genuinely useful
and interesting about this topic — the kind of concrete material that
makes an article feel substantial and credible.

KEEP: concrete facts, figures, ranges, comparisons, mechanics,
categories, native terminology, surprising counter-intuitive things.

IGNORE: navigation, footers, ads, author bios, comments, promo copy.

Do not follow any links. Do not invent. Output a dense factual digest
of ~250–350 words. Plain prose, no markdown, no bullet points.`,
        },
        {
          kind: 'p',
          text: 'Усі дайджести з 10 сторінок зливаються в один великий research-блок. Саме він далі іде у промт генерації статті — модель не бачить оригінальних сторінок, лише цей дайджест.',
        },
      ],
    },
    {
      id: 'ar-modes',
      label: 'Етап 4 — Три режими письма',
      blocks: [
        {
          kind: 'p',
          text: 'Поле mode переключає між трьома різними промтами. Стратегія спільна (утримати читача + не закривати інтент клікнути по Related Searches), але різна щільність конкретики. У UI дефолт — Balanced (mode=2).',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'mode = 1', v: 'Detailed — найщільніший режим. Реальні факти, ranges, порівняння + один bulleted-rundown параграф.' },
            { k: 'mode = 2', v: 'Balanced — дефолт. Тільки round-number ranges, без точних цифр і списків брендів.' },
            { k: 'mode = 3', v: 'Teaser — мінімум конкретики, майже без чисел. Максимальний curiosity gap.' },
          ],
        },

        // ---- Mode 1 — Detailed ----
        { kind: 'h3', text: 'Mode 1 — Detailed (say a lot, withhold the last piece)' },
        {
          kind: 'p',
          text: 'Найщільніший режим. Конкретні факти, типові ranges, порівняння — але без персонального вердикту: яка опція саме для читача, скільки саме він заплатить, кого саме обрати. У Detailed обов\'язково є один параграф (зазвичай p5) з трьома буллетами «• »: перші два — конкретика, третій — той самий фактор, що ВИРІШУЄ для читача, але навмисно залишений відкритим.',
        },
        {
          kind: 'prompt',
          label: 'Detailed — system message (abridged)',
          model: 'GPT-5.1',
          body: `You are a senior content writer for RSOC (Related Search on
Content) landing pages. Your article runs as a paid-traffic landing
page with a Google AFS Related Searches keyword box embedded right
after the introduction. The business earns when a reader clicks one
of those keywords.

LANGUAGE: {language} only — match regional spelling and idioms.
GEO: {GEO} — write for that geographic market.

THE STRATEGY — SAY A LOT, WITHHOLD THE LAST PIECE
A bland article that says nothing makes the reader bounce. A complete
article that answers everything leaves no reason to click. Write the
one that does both: rich, specific, concrete so the reader trusts it
and stays — while withholding the one personalized answer (which
option is right for THEM, the exact figure for THEIR case).

USE NUMBERS AND COMPARISONS
- Typical ranges ("monthly costs commonly fall within a wide band")
- Comparisons between options with their trade-offs
- Concrete mechanics, eligibility patterns, timeframes from the
  research digest

WHAT TO HOLD BACK (the reader's decisive personal answer only):
- The single "best" choice for their exact situation
- The precise figure that would apply to THEM
- The one named provider/program/product to pick

FIRST PARAGRAPH (p1, 50-65 words) MUST:
1. Confirm the topic is real in the first 1-2 sentences
2. Use the exact keyword terminology from the topic
3. Be concrete and interesting right away (no "in today's world")
4. Signal that the right answer is situational

THE BULLET RUNDOWN (REQUIRED — exactly one body paragraph, e.g. p5):
One short lead sentence introducing the points.
• First point — concrete, with a number, range, or comparison
• Second point — concrete
• Third — the factor that actually decides it, named but left open

WORD COUNTS (strict):
- p1: 50-65 words
- p2-p8: 85-110 words each
- Total body: 750-850 words`,
        },

        // ---- Mode 2 — Balanced ----
        { kind: 'h3', text: 'Mode 2 — Balanced (за замовчанням)' },
        {
          kind: 'p',
          text: 'Використовує круглі діапазони, не точні цифри. «Ставки зазвичай у межах 5–9 % залежно від профілю» — так. «Ставка 5.44 % APR» — заборонено. У кожному body-абзаці p2–p8 має бути щонайменше один round-number діапазон. Цільова щільність: 7–10 діапазонів на статтю.',
        },
        {
          kind: 'example',
          label: 'Що таке round-number range',
          body: `❌ ЗАНАДТО РОЗМИТО: "Rates depend on your profile"
❌ ЗАНАДТО ТОЧНО:  "Rates start at 5.44% APR"
✅ ПРАВИЛЬНО:      "Rates generally start in the mid single digits,
                    around 5 to 7 percent for strong credit profiles"`,
        },
        {
          kind: 'prompt',
          label: 'Balanced — system message (abridged)',
          model: 'GPT-5.1',
          body: `You are a writer for RSOC landing pages. The business gets paid when
readers click the Related Searches block.

LANGUAGE: {language} only.  GEO: {GEO}.

The sweet spot is CALIBRATED CREDIBILITY: round-number ranges that
signal scale and feel substantive, while withholding exact figures
that would close the reader's intent.

CORE DISTINCTION:
- Exact figures CLOSE intent ("5.44% APR" — no need to click)
- Round-number ranges OPEN intent ("around 5 to 9 percent depending
  on profile" — reader has scale but needs to drill into their case)

REQUIRED (round-number ranges):
- "around 5 to 9 percent", "in the low double digits, often 10 to 14"
- "typically 3 to 6 years", "anywhere from a few years up to 7 or 8"
- "commonly 1 to 3 percentage points higher"
- "a few thousand dollars in interest over the loan's life"
- "around 30 days", "about half a percentage point"
- The number that appears IN THE TOPIC ITSELF
- Category terminology (TAEG, FICO, APR, HUD, CRIF, NHS, ...)

FORBIDDEN (exact figures presented as facts):
- "5.44% APR", "$25,000 loan", "48 months", "FICO 720+"
- Specific dates ("January 15"), exact stats ("87% of applicants")
- Brand-specific rate quotes
- Enumerated comparison tables (no listing 5 providers with rates)

p1 STRICTEST RULES:
- ZERO numbers in p1 except the number in the topic itself
- Confirm topic real, match keyword terminology, indicate variability
- 50-60 words, strict

DENSITY CHECK before output: count round-number ranges in p2-p8.
Need 7-10 with at least ONE per paragraph. Below target = rewrite.

p2-p8: 75-110 words each, hard ceiling 800 total. Shorter often better.`,
        },

        // ---- Mode 3 — Teaser ----
        { kind: 'h3', text: 'Mode 3 — Teaser (агресивне утримання)' },
        {
          kind: 'p',
          text: 'Ніяких точних цифр (крім тих, що в самій темі). Ніяких списків брендів. Ніяких case studies. Підтверджує, що тема реальна, натякає на варіативність — і йде далі. Підходить для холодного Meta-трафіку на L1-Unaware / L2-Problem-Aware аудиторії, де щільна стаття «закриє» інтерес.',
        },
        {
          kind: 'prompt',
          label: 'Teaser — system message (abridged)',
          model: 'GPT-5.1',
          body: `You are a writer for RSOC landing pages. Articles run as paid-traffic
landing pages with a Google AFS Related Searches block embedded
mid-article. The business gets paid when readers click that block.

LANGUAGE: {language} only.  GEO: {GEO}.

YOUR REAL JOB: write articles that confirm the topic is real and
indicate the answers are nuanced, while WITHHOLDING the concrete
specifics. Readers must finish curious enough to click the related
searches box to get the details you intentionally did not give them.

A "comprehensive guide" that fully answers everything KILLS revenue.
An article that establishes credibility and opens curiosity loops
MAXIMIZES revenue. Confirmed by A/B testing across hundreds of
campaigns.

HARD RULES (NEVER VIOLATE):
1. NO SPECIFIC NUMBERS unless the number is part of the topic itself.
   FORBIDDEN: exact APRs (3.59%), prices ($300), terms (84 months),
   percentages (30% of income), dates, statistics ("87% of...").
   Replace with category language: "rates vary by provider and
   profile", "long contract durations", "fees depend on the program".
2. NO LIST OF SPECIFIC BRAND NAMES. Use "several major banks",
   "specialized lenders", "various established providers".
3. NO CASE STUDIES, ANECDOTES, OR TESTIMONIALS.
4. NO ACADEMIC PHRASING. Never "Studies have shown", "Research
   indicates", "Data suggests", "According to experts".
5. NO EXHAUSTIVE LISTS that close exploration intent.
6. NO GENERIC AI-STYLE OPENERS ("In today's [adjective] world...").
7. NO PROMOTIONAL LANGUAGE OR FAKE URGENCY.
8. NO REFERENCES TO ON-PAGE WIDGETS, SOURCES, LINKS, OR LISTS.

INTENT CLASSIFICATION (internal):
A. STRATEGIC EXPLORATION → aggressive withholding
B. UTILITY / LOOKUP      → soft withholding (keep the core utility)
C. GEO-SPECIFIC          → stay narrow to the keyword's geography
D. TRUST-HEAVY COMMERCIAL → calm informational tone, withhold rates

WORD COUNTS:
- p1: 50-60 words
- p2-p8: 75-100 words each
- Total body: 650-800 words. 800 is the MAX, not the goal.`,
        },

        // ---- Choosing a mode ----
        { kind: 'h3', text: 'Який режим обирати' },
        {
          kind: 'kv',
          rows: [
            { k: 'Detailed (1)', v: 'Цінні нішеві теми, де читач очікує субстанції (фінансові продукти, програми, юридика). Bulleted rundown додає структурного скану.' },
            { k: 'Balanced (2)', v: 'Дефолт. Дає достатньо щільності, щоб читач довірився, але без точних цифр, які закрили б питання.' },
            { k: 'Teaser (3)', v: 'Стратегічна exploration інтенту, холодна Meta-аудиторія, тема, де занадто конкретна стаття уб\'є RSOC-економіку.' },
          ],
        },
      ],
    },
    {
      id: 'ar-structure',
      label: 'Жорстка структура виводу',
      blocks: [
        {
          kind: 'p',
          text: 'Усі три режими повертають той самий формат: рівно 16 рядків з префіксами h1: … p8:. Парсер далі бере ці рядки і збирає HTML. Будь-який інший вивід ламає парсер.',
        },
        {
          kind: 'example',
          label: 'Структура виводу',
          body: `h1: [заголовок — рівний темі, якщо ≥5 слів]
p1: [вступ 50–60 слів — без жодної цифри, крім тієї, що в темі]
h2: [3–8 слів]
p2: [75–110 слів]
h3:
p3:
...
h8:
p8: [фінальний параграф — НЕ підписка, НЕ "see below", НЕ "the box"]`,
        },
        {
          kind: 'warn',
          title: 'Правило h1',
          text: 'Якщо твоя тема має 5 або більше слів — h1 буде нею ДОСЛІВНО (той же порядок слів, та сама пунктуація, той же регістр, без перефразовування). Це жорсткий override на рівні коду — навіть якщо модель спробує «креативно покращити», скрипт після генерації замінить h1 на оригінальний topic.',
        },
        {
          kind: 'warn',
          title: 'Що заборонено в самій статті',
          text: 'Жодних посилань на «related searches», «the box», «links below/above», «sources», «on this page». Стаття рендериться без видимого блоку джерел і без візуальних посилань — будь-яка згадка ламає враження. p8 має закриватися як звичайний інфо-абзац, не як sign-off у віджет.',
        },
      ],
    },
    {
      id: 'ar-html',
      label: 'Етап 5 — Convert to HTML',
      blocks: [
        {
          kind: 'p',
          text: 'Останній код-крок розбирає 16 рядків (h1:/p1:/…) у HTML-сторінку зі вшитими стилями. Карточний layout, типографіка, медіа-запити для мобілки — все включено. Сторінка повертається у webhook як text/html. Її можна одразу відкрити в браузері або вшити в лендінг.',
        },
        {
          kind: 'note',
          text: 'Параграфи з буллетами (Detailed mode) розпізнаються автоматично: рядки з префіксом «• » збираються у <ul><li>, решта — у <p>.',
        },
      ],
    },
  ],
};

// ---------- CREATIVES module ----------

const CREATIVES_MODULE: KBModule = {
  id: 'creatives',
  label: 'Creatives',
  tagline: 'Чотири колонки зліва направо: 1. Input Data → 2. Angles → 3. Concepts → 4. Creatives batches. Кожна колонка — окремий етап пайплайна і окремий HITL-чекпойнт.',
  sections: [
    {
      id: 'cr-overview',
      label: 'Огляд',
      blocks: [
        {
          kind: 'p',
          text: 'Сторінка Creatives розбита на 4 колонки. Кожна — окремий етап пайплайна: ти заповнюєш одну, тиснеш кнопку, отримуєш вивід у наступній, обираєш потрібне і йдеш далі. Між колонками 2 → 3 і 3 → 4 — точки, де вирішує оператор, не AI.',
        },
        {
          kind: 'steps',
          items: [
            { title: '1. Input Data', text: 'URL статті + 1–3 ключі + GEO + мова реклами + buyer + campaign name. Тиснеш Generate.' },
            { title: '2. Angles', text: 'AI повертає 3 стратегічні підходи на 3 різних когнітивних тригерах. Обираєш один → Select & Next.' },
            { title: '3. Concepts', text: 'З обраного angle AI робить 3 тактичні варіанти банера. Кожен — Hook + Accent + CTA + Meta-копія + compliance verdict. Обираєш один → Generate creatives.' },
            { title: '4. Creatives batches', text: 'Той самий концепт рендериться у 4 візуальних стилях (A / B / C / D), плюс можна додати Custom і Saved. Завантажуєш ZIP або шлеш у Telegram.' },
          ],
        },
        {
          kind: 'note',
          title: 'Чому під капотом саме так',
          text: 'Між колонками стоять 3 AI-агенти: Marketing Analyst (бачить input → готує фундамент), Strategist (будує angles), Copywriter (будує concepts). Візуал — це окрема image-генерація з vision-перевіркою. Деталі того, що саме робить кожен агент, — у відповідній колонці нижче.',
        },
      ],
    },

    // -------- 1. Input Data --------
    {
      id: 'cr-col1',
      label: '1. Input Data',
      blocks: [
        {
          kind: 'p',
          text: 'Стартова точка всього пайплайну. Поля визначають, ЩО продаємо (стаття), КОМУ (GEO + ключі), КИМ (buyer) і в межах якої кампанії. ШІ використовує URL статті + ключі, щоб зрозуміти аудиторію — далі все будується довкола цього.',
        },
        { kind: 'h3', text: 'Поля колонки' },
        {
          kind: 'kv',
          rows: [
            { k: 'Article URL *', v: 'Лендінг, на який поведе банер. Jina.ai парсить його — далі AI бачить лише title + перший абзац як primary context.' },
            { k: 'Keyword 1 *', v: 'Головний RSOC-ключ. Це PRIMARY-сигнал: усе подальше будується довкола інтенту саме цього ключа, не довкола статті.' },
            { k: 'Keyword 2 / 3', v: 'Опціональні додаткові ключі — розширюють розуміння аудиторного сегмента.' },
            { k: 'GEO *', v: 'Ринок під Meta-таргет. Впливає на регіональні референси у текстах і на §7 compliance (заборона «Near Me» / «in your area»).' },
            { k: 'Ad language', v: 'Мова фінальних рекламних текстів. Застосовується вже на колонці 3 (Concepts) — хуки, акценти, CTA, Meta-копія повертаються цією мовою. Список залежить від GEO.' },
            { k: 'Buyer *', v: 'Ім\'я медіабайєра. Йде в назви файлів і метаданих батча — для трекінгу хто запустив.' },
            { k: 'Campaign Name *', v: 'Ім\'я кампанії. Теж зашивається у file naming, щоб батч можна було впізнати в Telegram і в Ads Manager.' },
          ],
        },
        {
          kind: 'note',
          title: 'Чому стаття — primary, але другорядна за вагою',
          text: 'Користувач у feed Meta ще не бачить статті — він бачить банер. Банер має продати ПЕРЕХІД, а не повністю переказати статтю. Тому AI свідомо бачить лише teaser статті (title + перший абзац). Це не баг, це фіча.',
        },
        {
          kind: 'p',
          text: 'Тиснеш Generate → запускається перший AI-агент (Marketing Analyst, Claude Opus). Він аналізує ключі + статтю і повертає фундамент: keyword_intent, content_promise, bridge_point, 3 audience clusters, content_anchors, compliance_note. Цей фундамент ти безпосередньо не бачиш — він іде у наступного агента.',
        },
        {
          kind: 'prompt',
          label: 'Agent 1 — Marketing Analyst (abridged)',
          model: 'Claude Opus 4.7',
          body: `You are Agent Marketing Analyst for an RSOC creative pipeline.

CONTEXT: RSOC arbitrage. We buy Meta impressions → user clicks
creative → lands on article → sees RSOC keyword block → clicks
keyword → we get paid. Creative must bridge Meta feed to article.

PRIMACY RULE: the KEYWORDS are the leading input, not the article.
Keywords tell us what the user searched for and will see as
clickable on the landing page. The article headline + first
paragraph only provide tone/voice context.

═══════ METHOD (6 deterministic steps) ═══════

STEP 1 — KEYWORD INTENT:
  core_need, qualifier, intent_modifier, reasoning

STEP 2 — CONTENT PROMISE (from title + p1 only):
  main_promise, curiosity_angle, emotional_payoff

STEP 3 — BRIDGE POINT:
  Single sentence, 15-25 words. core_need + main_promise.

STEP 4 — 3 HOT AUDIENCE CLUSTERS (keyword-grounded):
  Goal: 3 HOTTEST clusters. Not 5, not 4 — exactly 3. Top-of-mind.
  HARD RULE: every cluster must be someone who would plausibly type
  ONE OF THE INPUT KEYWORDS into Google themselves.
  ❌ proxy personas (adult children searching for parents) — reject
  ❌ supply-side segments (real-estate agents) — reject
  ❌ generic filler ("people curious about X") — reject

STEP 5 — CONTENT ANCHORS:
  3-5 concrete nouns from the article (title + p1):
  - named or directly referenced
  - photographable / concrete (things, places, documents, actions)
  - not generic

STEP 6 — COMPLIANCE NOTE:
  Scan keywords + article for §7/§10/§2/§3/§11/§14 risks.`,
        },
      ],
    },

    // -------- 2. Angles --------
    {
      id: 'cr-col2',
      label: '2. Angles',
      blocks: [
        {
          kind: 'p',
          text: 'Тут AI повертає 3 СТРАТЕГІЧНІ підходи до банера — не самі заголовки. Кожен побудований на одному з 5 когнітивних тригерів. Це НЕ три варіанти заголовка, а три різні преміси, навколо яких міг би стояти банер. Обираєш один → Select & Next.',
        },
        { kind: 'h3', text: '5 когнітивних тригерів' },
        {
          kind: 'kv',
          rows: [
            { k: 'CG  Curiosity Gap', v: 'Loewenstein 1994 — створює інформаційну прірву між тим, що читач знає, і тим, що міг би знати. Найкраще під L1-Unaware аудиторію.' },
            { k: 'SR  Self-Reference', v: 'Rogers 1977 — активує «це про мене» через ШИРОКІ маркери ідентичності (вік, стадія життя, статус). Жодної вузької персоналізації типу «Раян Гослінг, ти?».' },
            { k: 'LA  Loss Aversion', v: 'Kahneman & Tversky — фокус на пропущеній вигоді / неклаймнутому бенефіті. ВИСОКИЙ §11 ризик: має звучати інформаційно, не як urgency-CTA.' },
            { k: 'PI  Pattern Interrupt', v: 'Зриває скрол нерекламним тоном. Звучить як новина / звіт / документ, не як промо.' },
            { k: 'BS  Belief Shift', v: 'Schwartz — суперечить домінантному припущенню аудиторії. Вимагає, щоб у angle був явно зазначений belief_being_shifted.' },
          ],
        },
        { kind: 'h3', text: 'Що показує картка angle\'а' },
        {
          kind: 'kv',
          rows: [
            { k: 'Code · Trigger', v: 'Кольорова мітка зверху (CG / SR / LA / PI / BS) і повна назва тригера.' },
            { k: 'Direction', v: '15–25 слів стратегічного підходу — що стверджує банер, але ще НЕ сам заголовок. Можеш редагувати, якщо хочеш скоригувати кут перед хуками — копірайтер читає саме цей текст.' },
            { k: 'Hook seed', v: 'Чорнова ідея заголовка на 8–12 слів. Навмисно неповна. Копірайтер з неї робить готовий хук по формулі (F2/F3/F4/F6).' },
            { k: 'Awareness level', v: 'L1 Unaware (взагалі не шукає тему) або L2 Problem-Aware (знає про проблему, але не про рішення). RSOC-трафік на Meta зазвичай L1–L2.' },
            { k: 'Emotional anchor', v: 'Одна емоція кута: Discovery / Hope / Relief / Concern / Pride / Indignation / Confidence / Curiosity. Без міксів. Визначає тон хука і настрій візуалу.' },
            { k: 'Why this works', v: 'Стратегічний guard rail для копірайтера: чому преміса працює і як саме вона лишає прірву, яку закриє Related Searches.' },
          ],
        },
        {
          kind: 'tip',
          title: 'Що робити, якщо жоден angle не подобається',
          text: 'У шапці колонки є кнопка Regenerate — перезапускає Strategist на тих самих даних з input. Виходить інша трійка тригерів. Можна крутити, поки не з\'явиться той самий «о, точно».',
        },
        {
          kind: 'prompt',
          label: 'Agent 2 — Strategist (abridged)',
          model: 'Claude Opus 4.7',
          body: `You are Strategist for an RSOC creative pipeline.

YOUR TASK: receive Agent 1 output → produce 3 strategic angles from
3 DIFFERENT cognitive triggers. Operator picks 1 → passed to Agent
3 Copywriter.

YOUR ROLE — STRATEGIC LAYER ONLY. You produce the PREMISE a banner
will assert. You do NOT write headlines, hooks, or taglines.
Agent 3 handles tactical realization.

═══════ 5 COGNITIVE TRIGGERS ═══════

CG — Curiosity Gap (Loewenstein 1994)
SR — Self-Reference (Rogers 1977)        — broad identity, not narrow
LA — Loss Aversion (Kahneman & Tversky)  — informational, not urgency
PI — Pattern Interrupt                   — non-ad framing
BS — Belief Shift (Schwartz)             — requires belief_being_shifted

DEPRECATED: AU (Authority) — too institutional, reads like PSA on
cold Meta broad. Substitute CG or BS.

═══════ METHOD (5 steps) ═══════

STEP 1 — AWARENESS LEVEL: L1 Unaware or L2 Problem-Aware
STEP 2 — SELECT 3 DIFFERENT triggers from CG/SR/LA/PI/BS
        L1 → prefer CG, PI, BS
        L2 → prefer SR, LA, BS
        Reject LA when no clear missed benefit (would force §14)
        Reject BS when no identifiable belief (would invent myth)
        Reject SR when audience too broad to mark identity
        Reject PI when content demands explicit promise framing

STEP 3 — DRAFT one angle per trigger (6 fields):
  direction         — 15-25 words STRATEGIC approach (not a hook)
  awareness_level   — L1 or L2
  belief_being_shifted — REQUIRED for BS, null otherwise
  emotional_anchor  — one of Discovery / Hope / Relief / Concern /
                       Pride / Indignation / Confidence / Curiosity
  why_works         — 10-20 words rationale
  why_this_works    — 25-40 words strategic GUARD RAIL for Agent 3
  hook_seed         — 8-12 words embryonic concept (intentionally
                       unfinished — Agent 3 must add formula structure)

STEP 4 — COMPLIANCE CHECK each angle against Agent 1's note
        (§7 location, §10 personal, §11 aggression, §14 specifics).

STEP 5 — OPERATOR SELECTION NOTE: 1-2 sentences on when each angle
        is best for operator context.

Return STRICT JSON only. The 3 codes MUST be different. AU forbidden.`,
        },
      ],
    },

    // -------- 3. Concepts --------
    {
      id: 'cr-col3',
      label: '3. Concepts',
      blocks: [
        {
          kind: 'p',
          text: 'З обраного angle AI робить 3 ТАКТИЧНІ варіанти банера. Кожен — окрема комбінація хук-формули + аспекту аудиторії + готових полів під Meta Ads Manager + compliance-вердикту. Обираєш один → пускаєш у візуальну генерацію.',
        },
        { kind: 'h3', text: '4 хук-формули' },
        {
          kind: 'kv',
          rows: [
            { k: 'F2 Surprise', v: '«[Несподіваний факт]. [Конкретний контекст].» — несподіванка, потім якір.' },
            { k: 'F3 Question', v: '«[Питання від третьої особи]. [Інформаційний поворот].» — питання, не у «do you», а у «who / what / how».' },
            { k: 'F4 Number', v: '«[Число]. [Контекст]. [Поворот].» — свіже конкретне число. Не вікові пороги — це банально.' },
            { k: 'F6 Contrast', v: '«[Поширена думка]. [Факт, що її перевертає].» — суперечність до загального уявлення.' },
          ],
        },
        {
          kind: 'note',
          title: 'F1 Problem і F5 Story — deprecated',
          text: 'F1 Problem звучить fear-mongery на холодному Meta-broad і валиться по §11 (агресія). F5 Story постійно провокує §14 (вигадані персонажі / цифри). У v15 живі тільки F2, F3, F4, F6.',
        },
        { kind: 'h3', text: 'Сумісність trigger ↔ formula' },
        {
          kind: 'example',
          label: 'Whitelist',
          body: `CG  Curiosity Gap     → F2, F3, F4, F6
SR  Self-Reference    → F2, F3, F4
LA  Loss Aversion     → F2, F3, F4
PI  Pattern Interrupt → F2, F3, F4
BS  Belief Shift      → F2, F4, F6`,
        },
        {
          kind: 'p',
          text: 'Формула, яка не у whitelist обраного тригера, відхиляється — навіть якщо хук «звучить добре». Це жорсткий стратегічний gate, не поетика.',
        },
        { kind: 'h3', text: 'Поля кожного концепту' },
        {
          kind: 'kv',
          rows: [
            { k: 'Category', v: 'Аудиторний аспект, який цей концепт тестує. Одна з 8 категорій (див. нижче). Усі 3 концепти тестують 3 РІЗНІ категорії — це жорсткий гейт.' },
            { k: 'Hook', v: '40–55 символів (макс 60). Головна фраза банера — те, що читач бачить перш за все.' },
            { k: 'Accent', v: '25–35 символів (макс 40). Другий, менший рядок під хуком. Додає конкретику або підсилює настрій, не дублює хук.' },
            { k: 'CTA', v: '8–12 символів (макс 15). Тільки з whitelist: Learn More, Read More, Discover More, Read Guide, Find Out, See More, Know More, Read On, Explore. Жодних Apply Now / Buy Now.' },
            { k: 'Meta ad title', v: '22–27 символів (макс 40). Заголовок оголошення в Ads Manager.' },
            { k: 'Meta ad copy', v: '100–120 символів (макс 125). Body-копія. Обов\'язково закінчується tail-тегом «Read Guide» (якщо CTA містить «Guide») або «Read Article» — окремою фразою після крапки, без trailing крапки.' },
            { k: 'Compliance', v: 'Зелений значок = пройшло перевірку, готове до запуску. Жовтий = знайдено можливе порушення; нижче Type / Description / Policy Reference кажуть, що саме.' },
          ],
        },
        { kind: 'h3', text: '8 категорій аудиторного аспекту' },
        {
          kind: 'kv',
          rows: [
            { k: '1 Demographic', v: 'Сегмент аудиторії — first-time / experienced / single / non-English-native тощо.' },
            { k: '2 Process Stage', v: 'Етап шляху — research, document gathering, application, waitlist.' },
            { k: '3 Emotional State', v: 'Що відчуває — overwhelm, relief, doubt, hope, anxiety, confidence.' },
            { k: '4 Logistical', v: 'Практичний вимір — документи, timeline, cost, eligibility rules.' },
            { k: '5 Outcome', v: 'Як виглядає «вирішено» — stable cost, independent living, security.' },
            { k: '6 Comparison', v: 'Проти чого — vs private rental, vs waiting too long, vs «too complicated».' },
            { k: '7 Identity Marker', v: 'Конкретний штрих ідентичності — pension income, life transition, work history.' },
            { k: '8 Scope', v: 'Наскільки широка можливість — number of options, types of units, program variety.' },
          ],
        },
        {
          kind: 'warn',
          text: 'Якщо всі 3 концепти лягають в одну категорію (наприклад, всі — про documents) — гейт відхиляє вивід і змушує копірайтера переробити. Це найчастіше падіння для свіжих юзерів.',
        },
        {
          kind: 'prompt',
          label: 'Agent 3 — Copywriter (abridged)',
          model: 'Claude Opus 4.7',
          body: `You are Copywriter for an RSOC creative pipeline.

YOUR TASK: given the chosen angle, write 3 creatives using 3 DIFFERENT
hook formulas. Each formula must be COMPATIBLE with the angle's
cognitive_trigger. Each creative tests a DIFFERENT aspect from a
DIFFERENT category.

GUARD RAIL: re-read chosen_angle.direction and why_this_works before
drafting each hook. Every hook must realize that premise. Drift = fail.

═══════ 4 HOOK FORMULAS ═══════
F2 Surprise:  [Unexpected fact]. [Named context].
F3 Question:  [Third-person question]. [Informational pivot].
F4 Number:    [Number]. [Context]. [Pivot].
F6 Contrast:  [Common belief]. [Fact that overturns it].

F1 (Problem) and F5 (Story) DEPRECATED — F1 reads fear-mongery, F5
triggers §14 (invented persons/scenes).

═══════ COMPATIBILITY MATRIX (Step 1B) ═══════
CG → F2, F3, F4, F6
SR → F2, F3, F4
LA → F2, F3, F4
PI → F2, F3, F4
BS → F2, F4, F6
Formula not in whitelist for trigger → reject.

═══════ CROSS-CATEGORY ASPECT PICK ═══════
Brainstorm 8+ aspects across 8 categories. Pick EXACTLY 3 from 3
DIFFERENT categories. Categories:
  1 Demographic  2 Process Stage  3 Emotional  4 Logistical
  5 Outcome      6 Comparison     7 Identity   8 Scope
Default-to-2+4 (process + logistics) = lazy. Reject.

═══════ CHARACTER LIMITS ═══════
banner_hook    40-55  (hard cap 60)
banner_accent  25-35  (hard cap 40)
banner_cta      8-12  (hard cap 15) — whitelist only:
  Learn More, Read More, Discover More, Read Guide, Find Out,
  See More, Know More, Read On, Explore
meta_ad_title  22-27  (hard cap 40)
meta_ad_copy  100-120 (hard cap 125)

META AD COPY TAIL TAG (mandatory):
  ends with "Read Guide" if banner_cta contains "Guide",
  otherwise ends with "Read Article".
  Standalone phrase after a period. No trailing period.

═══════ §12 SUBSTITUTION (mirroring trap) ═══════
"Free"  → "no-cost" / "through nonprofits" / "covered by"
"Cash"  → "financial help" / "monthly support"
"Win"   → "qualify for" / "access" / "receive"
The keyword may contain banned §12 words — echo the search INTENT,
not the search VOCABULARY.

ALL HOOKS must pass read-aloud / cold-audience test before output.
ZERO-TOLERANCE on §7 / §10 / §11 / §12 / §14 violations.`,
        },
        { kind: 'h3', text: 'Compliance Agent' },
        {
          kind: 'p',
          text: 'Кожен концепт автоматично перевіряється проти внутрішніх політик: медичні твердження, гарантії кредитів, транзакційна лексика, локаційний таргетинг, фейкові UI-елементи, відповідність статті. Без ретраю — рішення лишається за оператором.',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'Type', v: 'Категорія порушення — Misleading, False claim, Loan fraud, Location targeting, Article mismatch тощо.' },
            { k: 'Description', v: 'Короткий опис на 5–10 слів — конкретно, що не так.' },
            { k: 'Policy Reference', v: 'Внутрішній код політики. Достатньо подивитись на Type — категорія сама пояснює суть.' },
          ],
        },
        {
          kind: 'prompt',
          label: 'Compliance Agent — concept text (abridged)',
          model: 'Claude Opus 4.7',
          body: `ROLE & SCOPE
You are a content fact-checking analyst for an arbitrage company.
Determine whether advertising text complies with internal policies.
TRAINING analysis only.

INPUT: array of creatives in AIO format:
  formula, aspect_tested, aspect_category,
  banner_hook, banner_accent, banner_cta,
  meta_ad_title, meta_ad_copy
Optionally: "article" string (Title + Markdown Content).

EVALUATION PRINCIPLE
Content is COMPLIANT by default. Only flag CLEAR, CONCRETE
violations. Informational content about legal topics is OK.

ALLOWED (do NOT flag):
- Informational content that educates
- Intriguing headlines if not misleading
- "Learn more / Read more / Discover / Explore" CTAs
- Brand/product names in informational context
- References to "our article / guide / review"
- Banknotes and coins in financial context
- Capitalized text (capitalization alone is never a violation)

═══════ AD COPY TOPIC COHERENCE ═══════
meta_ad_title + meta_ad_copy must align thematically with
banner_hook + banner_accent. Catch obvious mismatches only.

═══════ PROHIBITED (14 policies) ═══════
1.  Medical Misinformation — cure claims, fake treatments, miracle
    drugs, close-up needles, before/after medical transformations
2.  Loans & Credit — guaranteed approval, no credit check, instant
    approval, fixed rate for everyone
3.  Financial / Investment Fraud — guaranteed returns, risk-free,
    "earn $X/week guaranteed", pyramid schemes
4.  False Urgency / Scarcity — "only today", fake countdowns,
    "limited offer" without real limit
5.  Fake UI / Prohibited Symbols — arrows pointing to fake areas,
    fake buttons, fake notifications, fake X/close, fake cursor
6.  Adult / Exploitation — nudity, sexual content, gore, hate
7.  Location Targeting — "Near me", "in your area", dynamic city
8.  Direct Sales — "Buy now", "Order today", specific prices
9.  Job / Employment Fraud — guaranteed hire, unrealistic salary
10. Privacy — asking for name, age, phone, email, address, religion
11. Aggressive Marketing — guilt, fear-mongering, manipulation
12. Intellectual Property — counterfeits, false brand affiliation
13. Government / Document Fraud — fake visas, guaranteed grants
14. ARTICLE COMPLIANCE (only if "article" field present):
    14.1-14.5  Cross-validation: title + hooks + accents + meta
               must be in the same thematic context as article_body.
               Specific numbers in any field MUST match article_body
               count (claim "5 symptoms" → article must list 5).
    14.6  First paragraph ≥ 45 words.
    14.7  article_body ≥ 700 words total.
    14.8  Last sentence of p1 must NOT contain "search below",
          "click these links", or similar immediate-interaction CTAs.
    14.9  PROHIBITED: claims absent from article_body, wording
          creating expectations not supported by body, adult content.
    14.10 PROHIBITED: fabricated facts, non-existent research,
          fake stats, fake expert attributions.

DECISION GUIDE
Before flagging, verify:
1. Does it appear in PROHIBITED above? If no → COMPLIANT.
2. Check "NOT prohibited" exceptions.
3. Informational content about a legal topic? Consider context.
4. Actual deception or just provocative framing? Flag only deception.

OUTPUT FORMAT (STRICT)
Return ONLY a JSON object. Per creative:
  compliant         boolean
  type              one of (Misleading | False claim | Prohibited
                    symbols | Fake UI | False urgency | Loan fraud |
                    Financial fraud | Job fraud | Location targeting |
                    Privacy violation | Aggressive marketing |
                    Article mismatch | Article quality |
                    Article content | Other)
  description       5-10 words
  policy_reference  which PROHIBITED section (1-14)`,
        },
        { kind: 'h3', text: 'Заборонена лексика — найгірші §-блоки' },
        {
          kind: 'kv',
          rows: [
            { k: '❌ free, 100% free', v: '✅ no-cost, through nonprofits, at no charge, covered by [program]' },
            { k: '❌ cash, cash assistance', v: '✅ financial help, monthly support, income supplement' },
            { k: '❌ win, winner', v: '✅ qualify for, receive, access, apply for' },
            { k: '❌ save big, cheap, discount', v: '✅ lower-cost, reduced rate, more affordable' },
            { k: '❌ gift, freebie, bonus, reward', v: '✅ included benefit, supplementary resource' },
            { k: '❌ earn money, make money', v: '✅ supplemental income source (обережно — часто все одно валиться)' },
          ],
        },
        {
          kind: 'warn',
          title: 'Mirroring trap: ключ ≠ копія банера',
          text: 'Якщо у RSOC-ключі є «Free Diapers» / «Cash for Seniors» / «Win a Grant» — це SEO-термін, який юзер вписує в Google. Але у банері ці слова заборонені. Передавай ІНТЕНТ, не VOCABULARY. «Free Diapers» → «Low-Cost Diapers» або «Diapers Covered For Tight Budgets».',
        },
        {
          kind: 'list',
          items: [
            '§7 Location — «Near Me», «near you», «local», «in your area», «by zip code».',
            '§10 Personal — «your X», «for you», «do you», «are you a» (друга особа в питаннях).',
            '§8 Transactional CTA — «Apply Now», «Get Started», «Claim», «Buy», «Sign Up». Дозволено лише whitelist.',
            '§11 Aggression — «don\'t miss out», «last chance», «act fast», «limited time».',
            '§14 Invented specifics — цифри, програми, дати, статистика, ЯКИХ НЕМАЄ у статті.',
          ],
        },
      ],
    },

    // -------- 4. Creatives batches --------
    {
      id: 'cr-col4',
      label: '4. Creatives batches',
      blocks: [
        {
          kind: 'p',
          text: 'Готові пакети креативів. Один батч = той самий хук / акцент / CTA, відрендерений у 4 різних візуальних стилях (A / B / C / D). Усі 4 використовують один текст — ти тестуєш, як саме візуальний стиль впливає на CTR.',
        },
        { kind: 'h3', text: '4 базових візуальних пресети' },
        {
          kind: 'kv',
          rows: [
            { k: 'A  YT Thumbnail', v: 'YouTube-thumbnail для віральної реклами — висока насиченість, сильний контраст, жирний хук + кнопка CTA. Кінематографічна подача. Стоп-скрол.' },
            { k: 'B  Organic Social', v: 'Виглядає як UGC-пост у стрічці. Великий хук з товстою обводкою поверх затемненого фото, декоративні пастельні стікери, курсивний CTA без кнопки.' },
            { k: 'C  Highlight Block', v: 'Повнокадрове фото + ОДИН однотонний блок зверху з хуком. Без акценту, без CTA. Найпростіший варіант.' },
            { k: 'D  Illustrated', v: 'Преміум native-ad стиль (як Outbrain/Taboola): редакторська ілюстрація на фоні, жовтий курсивний хук + біла картка + яскравий pill-CTA.' },
          ],
        },
        { kind: 'h3', text: 'Custom і Saved' },
        {
          kind: 'p',
          text: 'Поруч з A/B/C/D є ще два слоти. Custom — твій власний пресет, у якому можна включати / виключати каркасні блоки (Scene, Hook, Accent, CTA) і драгати їх у позицію всередині свого опису. Saved — твої збережені пресети, що шеряться з командою (адмін-функція).',
        },
        {
          kind: 'note',
          title: 'Що завжди ON у Custom',
          text: 'Text rules і Forbidden — це guard rails, які не можна вимкнути. Вони рендеряться на дефолтних позиціях: TR на початку, Forbidden у кінці. Чіпи для них не показуються навмисно — щоб байєр випадково не зняв.',
        },
        { kind: 'h3', text: 'Image-моделі і aspect ratio' },
        {
          kind: 'kv',
          rows: [
            { k: 'Nano banana 2 / pro', v: 'google/gemini-3.1-flash-image-preview / gemini-3-pro-image-preview. Дешеві, швидкі, добре тримають текст на банері.' },
            { k: 'GPT-image2', v: 'openai/gpt-5.4-image-2. Кращий за фотореалістичні сцени, гірший за стилізовані ілюстрації.' },
            { k: 'Seedream 4.5', v: 'bytedance-seed/seedream-4.5. Сильний у яскравій графіці й clickbait-композиції.' },
            { k: 'Aspect ratio', v: '1:1 / 16:9 / 9:16 / 4:5. Під feed або stories.' },
          ],
        },
        { kind: 'h3', text: 'Image Compliance (Custom + Saved)' },
        {
          kind: 'p',
          text: 'Згенероване зображення додатково проганяється через vision-агента: перевіряє verbatim-рендер хука / акценту / CTA, заборонені UI-елементи, контент дорослої тематики, медичні гарантії, прямі продажі, локаційний таргетинг, бренди.',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'Type', v: 'Verbatim mismatch / Fake UI / Adult content / Medical guarantee / Loan guarantee / Direct sales / Brand violation.' },
            { k: 'Description', v: '5–15 слів — що саме не так у зображенні або в тексті на ньому.' },
            { k: 'Policy Reference', v: '1 Text rendering / 2 Fake UI / 3 Visual content / 4 Text content / 5 Brand.' },
          ],
        },
        {
          kind: 'note',
          text: 'Image Compliance запускається ТІЛЬКИ для Custom і Saved. Базові пресети A/B/C/D написані заздалегідь і не проганяються — вони і так у whitelist.',
        },
        {
          kind: 'prompt',
          label: 'Compliance Agent (Image) — vision check (abridged)',
          model: 'google/gemini-3-pro (vision)',
          body: `ROLE & SCOPE
You are an image compliance auditor for an internal ad-banner
training pipeline. You examine ONE banner image and return whether
it complies with image-only policies.

INPUT
One image attached + the EXPECTED text overlays the banner is
supposed to render (HOOK / ACCENT / CTA).

EVALUATION PRINCIPLE
COMPLIANT by default. Only flag CLEAR, CONCRETE violations.

═══ 5 IMAGE-ONLY POLICIES ═══

1. TEXT RENDERING (verbatim)
   HOOK / ACCENT / CTA must appear EXACTLY as provided:
   same words, same count, no duplication, no substitution,
   no invented words. Capitalization changes are OK.
   → Flag: Verbatim mismatch

2. FAKE UI ELEMENTS
   Prohibited: arrows pointing to fake clickable areas,
   fake buttons/checkboxes/radios simulating interactivity,
   simulated notifications, fake download/progress bars,
   fake close/X, fake cursor.
   The legitimate styled CTA pill is NOT a fake button.
   → Flag: Fake UI

3. PROHIBITED VISUAL CONTENT
   Prohibited: nudity / sexual / suggestive, graphic violence
   or gore, hate symbols, close-up medical (needles, injections,
   rotten teeth, surgical wounds), before/after medical.
   → Flag: Adult content / Violence / Medical visual

4. PROHIBITED TEXT CONTENT rendered on the image
   - Medical guarantees     → Medical guarantee
   - Loan guarantees        → Loan guarantee
   - Investment promises    → Investment promise
   - False urgency          → False urgency
   - Direct sales           → Direct sales
   - Location targeting     → Location targeting
   - Personal data fields   → Privacy violation

5. INTELLECTUAL PROPERTY
   Prohibited: real recognizable brand logos used without
   authorization, counterfeit goods, unauthorized celebrity
   faces / likenesses.
   → Flag: Brand violation

NOT PROHIBITED (do NOT flag):
- Decorative stickers / icons (Preset B aesthetic)
- Drop shadows, outlines, text strokes
- Banknotes and coins in financial contexts
- Hands holding everyday objects
- Capitalized text
- The legitimate styled CTA pill button

═══ OUTPUT FORMAT (STRICT) ═══
Return ONLY a JSON object:
  compliant         boolean
  type              one of the Type tokens above, or empty if compliant
  description       5-15 words, or empty
  policy_reference  one of: "1 Text rendering" | "2 Fake UI" |
                    "3 Visual content" | "4 Text content" | "5 Brand"
                    (empty when compliant)

Examine ONLY the image and text rendered on it.`,
        },
        { kind: 'h3', text: 'Як вивантажити батч' },
        {
          kind: 'list',
          items: [
            'Кнопка Download — ZIP з 4 PNG/JPG і файлом info.txt, де продубльоване нагадування про Ad name.',
            'Кнопка Send to Telegram — батч прилітає у робочий чат: спершу header (ID батча, angle, hook), потім 4 фото з підписами (Hook / Accent / CTA + Meta-поля), наприкінці — нагадування.',
            'Ім\'я ZIP = batch_<execution_id> — той самий ID, що в Telegram. По ньому можна знайти будь-який старий батч.',
            'Імена файлів стандартизовані: aiimg_<topic>_<geo>_<index>_<angleCode>_<formula>_<lang>_<seed>_<model>_<variant>.jpg.',
          ],
        },
        {
          kind: 'warn',
          title: 'Обов\'язково: Ad name = ім\'я файлу',
          text: 'У Facebook Ads Manager поле «Ad name» має ДОРІВНЮВАТИ імені файлу креативу. Це єдиний місточок, що дозволяє трекати performance по варіанту в постпродажі. Нагадування про це автоматично прилітає останнім повідомленням у батчі і дублюється в info.txt у ZIP.',
        },
      ],
    },
  ],
};

// ---------- CREATIVE GEN module ----------

const CREATIVE_GEN_MODULE: KBModule = {
  id: 'creative-gen',
  label: 'Creative Gen',
  tagline: 'Швидка генерація креативів без пайплайна: вручну впиши Hook / Accent / CTA, обери модель і пресети — і одразу отримай батч банерів. Ідеально під готові тексти або A/B по візуалу.',
  sections: [
    {
      id: 'cg-overview',
      label: 'Огляд',
      blocks: [
        {
          kind: 'p',
          text: 'Creative Gen — це shortcut повного пайплайна Creatives. Ти пропускаєш Keywords → Angles → Concepts і одразу віддаєш моделі готові Hook / Accent / CTA. За кулісами працює той самий Visual Director + рендер у 4 пресети, але без верхньої частини (без Marketing Analyst, без Strategist, без Copywriter). Немає article, немає angle — лише текст, який ти написав.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'Fill Hook / Accent / CTA', text: 'Впиши три рядки вручну. Hook — обов\'язковий (кнопка згасне, якщо порожній). Accent / CTA — опційні.' },
            { title: 'Pick image settings', text: 'Той самий Image Gen Settings, що у вкладці Creatives: модель (Nano banana / GPT-image / Seedream), aspect ratio, ad language, і які пресети зі списку A/B/C/D + Custom + Saved запускати.' },
            { title: 'Generate Creative Batch', text: 'Кнопка каже, скільки пресетів у батчі: наприклад "Generate Creative Batch (4)". Тиснеш — n8n workflow починає рендер.' },
            { title: 'Отримуєш батч', text: 'Той самий формат, що у вкладці Creatives: набір креативних варіантів під кожен активний пресет. ZIP / Telegram / lightbox — усе стандартне.' },
          ],
        },
        {
          kind: 'note',
          title: 'Файли позначаються «creativeonly»',
          text: 'У імені файлу креативу сегмент, який у повному пайплайні містить назву кампанії / кут / формулу, замінюється на «creativeonly». Так у Ads Manager і Dashboard видно, що батч зроблений через Creative Gen, а не через повний потік.',
        },
        {
          kind: 'warn',
          title: 'Що Creative Gen НЕ робить',
          text: 'Не пропонує тобі кути, не пише хуки за тебе, не перевіряє тексти на compliance перед рендером. Це саме інструмент виконавця, не стратега. Якщо треба ідеї — йди у вкладку Creatives (4 колонки).',
        },
      ],
    },
    {
      id: 'cg-inputs',
      label: 'Поля, які ти заповнюєш',
      blocks: [
        { kind: 'h3', text: 'Creative text (обов\'язкова частина)' },
        {
          kind: 'kv',
          rows: [
            { k: 'Hook *', v: 'Головний рядок банера, 40–55 символів (макс 60). Обов\'язковий — без нього кнопка Generate згасне.' },
            { k: 'Accent', v: 'Другий, менший рядок під хуком. 25–35 символів (макс 40). Опційний.' },
            { k: 'CTA', v: 'Кнопка / підпис-заклик: Learn More / Read More / Discover More / Find Out / Explore. 8–12 символів. Опційний.' },
          ],
        },
        { kind: 'h3', text: 'Image Gen Settings (спільна панель)' },
        {
          kind: 'kv',
          rows: [
            { k: 'Модель', v: 'Nano banana 2 / pro (gemini-3.1-flash-image / gemini-3-pro-image-preview), GPT-image2 (gpt-5.4-image-2) або Seedream 4.5 (bytedance-seed).' },
            { k: 'Aspect ratio', v: '1:1 / 16:9 / 9:16 / 4:5. Той самий вибір, що у Creatives.' },
            { k: 'Ad language', v: 'Мова тексту на банері. Якщо мова відрізняється від мови вхідних Hook/Accent/CTA — пайплайн додатково перекладає їх перед рендером.' },
            { k: 'Пресети', v: 'A / B / C / D базові + Custom + Saved. Мінімум один має бути активним, інакше кнопка згасне.' },
          ],
        },
        {
          kind: 'tip',
          title: 'Ідеальний use-case',
          text: 'Готовий копірайтерський хук з іншого джерела (Angles-вкладка, Slack, Notion) — і треба швидко зробити 4 візуальні варіанти на A/B у Meta. Тут economics найкращий: тексти вже вивірені, кошти йдуть тільки на візуал.',
        },
      ],
    },
    {
      id: 'cg-pipeline',
      label: 'Що робить бекенд',
      blocks: [
        {
          kind: 'p',
          text: 'За кнопкою стоїть окремий n8n workflow (не той самий, що у Creatives — там повний ланцюг з 4 агентами). CreativeOnly-Image Generator має тільки два основні AI-кроки: Visual Director і рендер зображення на моделі. Все інше — механіка (translate, filter, aggregate, cost log).',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'Endpoint', v: 'POST /generate_creatives_only' },
            { k: 'Payload', v: 'chosen_creative = {banner_hook, banner_accent, banner_cta, meta_ad_title (порожньо), meta_ad_copy (порожньо)}. Плюс параметри рендеру (модель, aspect, presets, ad_language).' },
            { k: 'Async pattern', v: 'Одразу після старту webhook повертає execution_id (202-подібна поведінка). Фронт полить статус, як для звичайного батча Creatives.' },
          ],
        },
        {
          kind: 'steps',
          items: [
            { title: 'Respond to FE with execution_id', text: 'Одразу зафайлити job у стані, віддати ID фронту. Далі — асинхронно.' },
            { title: 'Visual Director (Agent 4)', text: 'Claude Opus 4.7 читає ТІЛЬКИ хук (accent / cta — довідково). Виводить hero, композицію, сцену, реквізит, настрій. Це той самий Agent 4, який у повному пайплайні, але тепер без upstream-контексту від Analyst / Strategist / Copywriter.' },
            { title: 'Filter Active Presets', text: 'З UI-налаштувань беруться активні пресети — A/B/C/D + Custom + Saved. Fanout на N паралельних гілок.' },
            { title: 'OpenRouter Image (для кожного пресета)', text: 'Виклик обраної image-моделі з відповідним стилем-обгорткою пресета. Тексти хука/акценту/CTA передаються дослівно як overlay-інструкції.' },
            { title: 'Compliance gate (Custom + Saved only)', text: 'Для Custom і Saved пресетів згенероване зображення проганяється через vision-агента. Базові A/B/C/D мають whitelist-стилі і навмисно пропускають цей крок.' },
            { title: 'Aggregate Images', text: 'Об\'єднання результатів всіх пресетів у один response. Кожна картинка тегається (variant, style, meta_title, meta_copy, banner_cta, compliant).' },
            { title: 'Cost log', text: 'Паралельна гілка пише вартість (Build Cost — Image + Build Cost — Compliance) у cost_log datatable для Dashboard → Costs.' },
          ],
        },
        {
          kind: 'note',
          title: 'Візуал під хук — з чого модель це бере',
          text: 'У повному пайплайні Agent 4 бачить keyword intent, audience clusters, content anchors, обраний angle і chosen creative. У Creative Gen вона бачить лише хук. Це навмисно: якщо хук написаний добре, він сам несе інформацію про аудиторію, тон, тему. Якщо хук розмитий — і візуал буде розмитим. Пропорційна відповідальність.',
        },
      ],
    },
    {
      id: 'cg-visual-director',
      label: 'Visual Director — як він читає хук',
      blocks: [
        {
          kind: 'p',
          text: 'Agent 4 отримує на вхід лише твої три рядки і має вивести повний visual brief. Він робить це за детермінованою методикою: спочатку відповідає собі на три питання по хуку (хто, що, який register), далі мапить це у композицію та engagement mode за формулою mode_index = base_index % 4.',
        },
        { kind: 'h3', text: '4 engagement modes (детермінована ротація)' },
        {
          kind: 'kv',
          rows: [
            { k: '0 · Indoor-contemplative', v: 'Герой за столом з документами. Використовується обережно — легко скотитися в депресивну атмосферу.' },
            { k: '1 · Threshold-arrival', v: 'Герой у дверях, тримає один предмет. Сигнал «щойно прибув / щойно дістав».' },
            { k: '2 · Outdoor-transition', v: 'Герой надворі біля будівлі, з телефоном чи конвертом. Сигнал «дорогою до відкриття».' },
            { k: '3 · Exchange-social-light', v: 'Герой біля стійки з помічником, який показує на бланк. Людський масштаб допомоги.' },
          ],
        },
        { kind: 'h3', text: 'Що виходить з Visual Director' },
        {
          kind: 'list',
          items: [
            'vertical (housing / health / finance / lifestyle / other)',
            'composition_type — SUBJECT_WITH_REACTION / SUBJECT_CENTERED / OBJECT_HEAVY / DUAL_COMPOSITION',
            'hero_element — subject, subject_matter_type, engagement_mode, pose_and_expression',
            'scene_context — setting, props_in_frame, background',
            'visual_mood — emotional_tone, color_direction, lighting_style',
            'Variant C swap — якщо у brief є люди, для пресета C (Highlight Block) окремо будується object-only flat-lay',
          ],
        },
        {
          kind: 'prompt',
          label: 'Visual Director — hook-only prompt (abridged)',
          model: 'Claude Opus 4.7',
          body: `You are the Visual Director for the creative-only banner
pipeline.

YOUR TASK: Read the operator-approved creative texts
(banner_hook / banner_accent / banner_cta) and produce a VISUAL
BRIEF as ONE JSON object. There is NO upstream research, NO chosen
angle and NO article in this pipeline — the hook text itself is
your ONLY source of audience and topic context.

STEP 0 — READ THE HOOK
Answer:
- WHO is this hook talking to (age, situation, identity marker)?
- WHAT concrete thing is it about (product, program, event)?
- WHAT register does it use (institutional / casual / journalistic
  / conversational)?

engagement_mode = base_index % 4:
  0 = indoor-contemplative (hero at table with documents)
  1 = threshold-arrival (hero at doorway, one prop)
  2 = outdoor-transition (hero outdoors, phone/envelope)
  3 = exchange-social-light (hero at counter with helper)

composition_type — one of:
  SUBJECT_WITH_REACTION | SUBJECT_CENTERED |
  OBJECT_HEAVY | DUAL_COMPOSITION

Variant C swap: if hero_element has people, for preset C
(Highlight Block) generate an object-only flat-lay instead.

OUTPUT — STRICT JSON with: vertical, composition_type,
hero_element {subject, subject_matter_type, engagement_mode,
pose_and_expression}, scene_context {setting, props_in_frame,
background}, visual_mood {emotional_tone, color_direction,
lighting_style}.`,
        },
      ],
    },
    {
      id: 'cg-presets',
      label: '4 пресети — той самий контракт, що у Creatives',
      blocks: [
        {
          kind: 'p',
          text: 'Пресети A / B / C / D — це ті самі стилі, що у вкладці Creatives. Один Visual Director brief → чотири рендери у чотирьох estilos. Кастомні пресети (Custom, Saved) підтримуються, і для них вмикається image compliance gate.',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'A · YT Thumbnail', v: 'YouTube-style clickbait: висока насиченість, сильний контраст, жирний хук + кнопка CTA.' },
            { k: 'B · Organic Social', v: 'UGC-стиль: великий хук з обводкою, декоративні пастельні стікери, курсивний CTA без кнопки.' },
            { k: 'C · Highlight Block', v: 'Повнокадрове фото + один однотонний блок з хуком. Без акценту, без CTA. Якщо у brief є люди — Visual Director автоматично випльовує object-only flat-lay для цього пресета.' },
            { k: 'D · Illustrated', v: 'Native-ad стиль (Outbrain/Taboola): редакторська ілюстрація, жовтий курсивний хук + біла картка + pill-CTA.' },
            { k: 'Custom / Saved', v: 'Твої пресети. Проходять image compliance gate — vision-агент перевіряє verbatim рендер тексту, заборонені UI, adult / medical / brand порушення.' },
          ],
        },
      ],
    },
    {
      id: 'cg-response',
      label: 'Що повертається',
      blocks: [
        {
          kind: 'p',
          text: 'Фінальна відповідь — плоский об\'єкт з полями image_{a|b|c|d}_url і супутньою метою для кожного варіанта. Це та сама форма, яку споживає Column4 (компонент батчів), тому Creative Gen і Creatives рендеряться однаково.',
        },
        {
          kind: 'example',
          label: 'Форма відповіді (укорочено)',
          body: `{
  "images": ["url1", "url2", "url3", "url4"],
  "image_count": 4,

  "image_a_url": "https://.../batch_<id>_a.jpg",
  "style_a": "YT Thumbnail",
  "meta_title_a": "",
  "meta_copy_a": "",
  "banner_cta_a": "Learn More",
  "compliant_a": true,

  "image_b_url": "...",
  ...
}`,
        },
        {
          kind: 'note',
          text: 'meta_title / meta_copy у Creative Gen лишаються порожніми — Copywriter у пайплайні не запускався, тож нема з чого їх сформувати. Якщо тобі треба Meta Ad Manager поля — пиши їх руками або запускай повний пайплайн Creatives.',
        },
      ],
    },
    {
      id: 'cg-vs',
      label: 'Creative Gen vs Creatives vs Creative Edit',
      blocks: [
        {
          kind: 'kv',
          rows: [
            { k: 'Creatives (4 колонки)', v: 'Повний RSOC-пайплайн. Ти даєш URL статті + ключі, AI видає angles → concepts → creatives → images. Використовуй, коли треба стратегічно розкрити нішу з нуля.' },
            { k: 'Creative Gen (ця вкладка)', v: 'Хуки вже готові — просто перетвори їх у 4 візуальні варіанти. Пропускає Analyst / Strategist / Copywriter. ~10–20 сек замість 30–60.' },
            { k: 'Creative Edit — Change Image', v: 'У тебе вже є банер, треба лише замінити тексти / перекласти / прибрати логотип. Image-to-image edit, зберігає композицію оригіналу.' },
            { k: 'Creative Edit — Change Approach', v: 'У тебе є банер і стаття, але тексти треба переосмислити з нуля з різних кутів. AI аналізує статтю + оригінал, дає 5 унікальних варіантів (Hook / Accent / CTA / Title / Description) з різними механіками, потім рендерить обраний варіант на банер зі збереженням композиції.' },
          ],
        },
      ],
    },
  ],
};

// ---------- CREATIVE EDIT module ----------

const CREATIVE_EDIT_MODULE: KBModule = {
  id: 'creative-edit',
  label: 'Creative Edit (Change Image)',
  tagline: 'Режим Change Image: хірургічне редагування вже готового банера — заміна Hook / Accent / CTA, переклад тексту і опційні візуальні коригування — з збереженням композиції і стилю оригіналу.',
  sections: [
    {
      id: 'ce-overview',
      label: 'Огляд',
      blocks: [
        {
          kind: 'p',
          text: 'Creative Edit — це НЕ регенерація з нуля. Вкидаєш існуючий банер, кажеш, що змінити (тексти, мова, дрібні візуальні правки) — і отримуєш той самий банер із хірургічно змінені частинами. Композиція, фон, логотипи, реквізит, освітлення, шрифт, стиль тексту — усе лишається пиксельно ідентичним оригіналу. Змінюється тільки те, що ти явно назвав.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'Upload creative', text: 'PNG / JPG / WebP. Тільки статичні зображення. Файл летить у бекенд як base64 data URL (не multipart) — так надійніше через Cloudflare + n8n.' },
            { title: 'Analyze image (опційно)', text: 'Vision-модель читає банер і повертає поточні Hook / Accent / CTA — щоб не переписувати їх вручну.' },
            { title: 'Fill Hook / Accent / CTA', text: 'Замінюй тільки те, що треба. Порожнє поле = стерти цей напис зовсім. Незачеплене поле = лишити оригінал.' },
            { title: 'Aspect ratio + Language', text: '1:1 / 16:9 / 9:16 / 4:5 — розмір виводу. Language керує перекладом; за замовчуванням «Keep original language».' },
            { title: 'Image prompt (опційно)', text: 'Дрібні правки візуалу: «зміни фон на синій», «прибери логотип», «зроби CTA-кнопку червоною». Порожнє = тільки тексти.' },
            { title: 'Generate', text: 'Gemini 3-pro-image-preview працює в режимі image-to-image edit — оригінал у виводі, зміни тільки там, де ти сказав.' },
          ],
        },
        {
          kind: 'note',
          title: 'Дві окремі кнопки — дві окремі кінцеві точки',
          text: 'Analyze image і Generate Edited Creative — це РІЗНІ вебхуки: /creative_edit_analyze і /creative_edit_generate. Analyze — швидко, використовується для попереднього заповнення полів. Generate — саме редагування. Analyze не змінює зображення, лише читає його.',
        },
      ],
    },
    {
      id: 'ce-inputs',
      label: 'Поля, які ти заповнюєш',
      blocks: [
        {
          kind: 'kv',
          rows: [
            { k: 'Creative image *', v: 'PNG / JPG / WebP. Drag & drop або кліком. Показується прев\'ю прямо у формі.' },
            { k: 'Aspect ratio *', v: '1:1 (дефолт) / 16:9 / 9:16 / 4:5. Керує розмірами виходу — модель не збереже пропорції оригіналу автоматично, обирай відповідне.' },
            { k: 'Language', v: '«Keep original language» (дефолт) або одна з 40+ мов зі списку. Якщо не «Keep original», перекладачик перекладає Hook / Accent / CTA перед рендером.' },
            { k: 'Hook', v: 'Головний рядок банера, 40–55 символів. Порожній Hook = стерти оригінальний. Обов\'язковий, якщо збираєшся генерувати.' },
            { k: 'Accent', v: 'Другий, менший рядок під хуком. 25–35 символів. Порожній = стерти.' },
            { k: 'CTA', v: 'Кнопка / підпис-заклик. Порожній = стерти CTA з банера.' },
            { k: 'Image prompt adjustments', v: 'Опційне вільне поле англійською. Приклади: «зміни фон на синій», «прибери логотип у нижньому куті», «зроби CTA-кнопку червоною». Не пиши сюди повний рерайт стилю — Gemini інтерпретує це як «додаткова хірургічна правка», не як директиву перемалювати банер.' },
          ],
        },
        {
          kind: 'tip',
          title: 'Порожнє поле ≠ «залиш як є»',
          text: 'Якщо не хочеш чіпати CTA — просто НЕ проходь Analyze і не заповнюй CTA. Тоді напис лишається на банері. Але якщо ти явно очистив поле (Analyze заповнив, а ти стер) — модель СТЕРЕ CTA з зображення. Порожнє = «прибери».',
        },
      ],
    },
    {
      id: 'ce-analyze',
      label: 'Крок 1 — Analyze image (опційно)',
      blocks: [
        {
          kind: 'p',
          text: 'Кнопка «Analyze image» шле банер у vision-агента, який повертає три поля: hook, accent, cta. Порожні поля лишаються порожніми (модель не вигадує текст на місці, де його нема). Тоді ти можеш підредагувати їх у формі, а не набирати з нуля.',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'Endpoint', v: 'POST /creative_edit_analyze' },
            { k: 'Model', v: 'google/gemini-3.1-pro-preview (з fallback на gemini-2.5-pro або claude-opus-4.7 через OpenRouter)' },
            { k: 'Temperature', v: '0 — детермінований вивід' },
            { k: 'Response format', v: 'json_object — модель зобов\'язана повернути валідний JSON {hook, accent, cta}' },
          ],
        },
        {
          kind: 'prompt',
          label: 'Vision LLM Analyze — system prompt',
          model: 'google/gemini-3.1-pro-preview',
          body: `Extract three banner text fields from this creative image:
(1) hook = the largest/most prominent headline line,
(2) accent = the secondary supporting line if present,
(3) cta = the call-to-action button text if present.

Return ONLY a JSON object with keys hook, accent, cta —
empty string for missing fields.
No prose, no markdown fences.`,
        },
        {
          kind: 'note',
          text: 'Analyze нічого не зберігає і не змінює зображення. Просто читає. Викликаєш стільки разів, скільки треба — це швидкий і дешевий крок.',
        },
      ],
    },
    {
      id: 'ce-translate',
      label: 'Крок 2 — Переклад (опційно)',
      blocks: [
        {
          kind: 'p',
          text: 'Якщо у полі Language обрано конкретну мову (не «Keep original») — перед рендером тексти проходять через окремий переклад Claude Opus. Переклад маркетинговий, а не дослівний: зберігає intent, ідіоматику, характер копірайтингу.',
        },
        {
          kind: 'prompt',
          label: 'Translate Texts — system prompt',
          model: 'anthropic/claude-opus-4.7',
          body: `You translate three banner text fields into a target language.

## INPUT FORMAT
Target language: <language_name OR a directive in parentheses>
Texts to translate: <JSON object with keys hook, accent, cta>

## OUTPUT
Return ONLY a JSON object with keys hook, accent, cta.
No markdown fences, no commentary, no preamble.

## TRANSLATION RULES
1. If "Target language" is empty, blank, starts with "(", or says
   "keep original", return the input JSON UNCHANGED.
2. Otherwise, translate each NON-EMPTY field into the target
   language. Preserve marketing intent and tone — these are ads.
   Make them natural, persuasive, and idiomatic. NOT word-for-word.
3. Keep numbers, ages, currency, and proper nouns intact
   ("62+", "$5,000", brand names).
4. EMPTY input fields STAY EMPTY in the output. NEVER invent text
   to fill an empty field. An empty hook stays an empty hook.
5. Preserve punctuation that carries emotional weight (!, ?, …).
6. Maintain capitalization style appropriate to the target language.
7. If target language matches source language, return unchanged.

## CRITICAL CONSTRAINTS
- Output keys are exactly hook, accent, cta.
- NEVER wrap output in \`\`\`json fences.
- NEVER include any text before or after the JSON object.
- Preserve data types (empty strings stay empty strings).
- If you cannot confidently translate a field, return it unchanged.`,
        },
        {
          kind: 'warn',
          title: 'Числа, %, брендові назви — не перекладаються',
          text: '«$5,000» лишається «$5,000», «62+» лишається «62+», «Medicare» лишається «Medicare» навіть у польській версії. Це виключення з правила «маркетинговий переклад» — цифри і бренди дослівно.',
        },
      ],
    },
    {
      id: 'ce-generate',
      label: 'Крок 3 — Хірургічний рендер',
      blocks: [
        {
          kind: 'p',
          text: 'Основний крок: Gemini 3-pro-image-preview працює в режимі image-to-image edit. Промт побудований жорстко навколо ідеї «це НЕ регенерація». Модель отримує ERASE LIST (позиції, які треба стерти) і RENDER LIST (позиції + верним текст для рендеру), і має право змінювати ТІЛЬКИ ці області плюс те, що явно вказано у Image prompt adjustments.',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'Endpoint', v: 'POST /creative_edit_generate' },
            { k: 'Model', v: 'google/gemini-3-pro-image-preview (vision + generation, OpenRouter)' },
            { k: 'Temperature', v: '1 — креативний, з рандомним seed для різноманіття варіантів' },
            { k: 'Image size', v: '1K, aspect_ratio з поля форми' },
          ],
        },
        { kind: 'h3', text: 'Чотири жорсткі правила editing-промта' },
        {
          kind: 'list',
          items: [
            'RULE 1 — ERASE ALL ORIGINAL TEXT FIRST. Спершу стирається весь оригінальний напис у зазначених позиціях. Без цього новий текст ляже поверх старого і буде каша.',
            'RULE 2 — RENDER ONLY THE STRINGS ON THE Text-to-render LINES. Модель ЗОБОВ\'ЯЗАНА рендерити рядки verbatim — той самий регістр, та сама пунктуація, той самий порядок слів. Ніякого «покращення».',
            'RULE 3 — POSITIONS IN THE ERASE LIST HAVE NO TEXT. Якщо поле порожнє — область стається порожньою. Модель не має права заповнити її іншим текстом «щоб було симетрично».',
            'RULE 4 — CHANGE ONLY WHAT IS NAMED. Усе поза ERASE / RENDER / Image adjustments лишається пиксельно однаковим з оригіналом. Фон, логотипи, реквізит, шрифт, тіні, обводки, освітлення — не чіпати.',
          ],
        },
        {
          kind: 'example',
          label: 'Як формується editing-промт',
          body: `You are performing a SURGICAL EDIT on the attached banner
image. This is an EDIT, not a regeneration — preserve the input
pixel-faithfully except for the specific changes named below.

TEXT-TO-RENDER (verbatim, exact):
- HOOK position: "<new hook or empty>"
- ACCENT position: "<new accent or empty>"
- CTA position: "<new cta or empty>"

ERASE LIST (positions with empty text-to-render):
- <positions with empty inputs>

RENDER LIST (positions with non-empty text-to-render):
- <positions with populated inputs>

ADDITIONAL VISUAL ADJUSTMENTS:
<user-provided imagePrompt, or "none">

RULE 1 — ERASE ALL ORIGINAL TEXT FIRST
RULE 2 — RENDER ONLY THE STRINGS ON THE Text-to-render LINES
RULE 3 — POSITIONS IN THE ERASE LIST HAVE NO TEXT
RULE 4 — CHANGE ONLY WHAT IS NAMED`,
        },
      ],
    },
    {
      id: 'ce-output',
      label: 'Що повертається',
      blocks: [
        {
          kind: 'p',
          text: 'Відповідь — JSON з масивом images. Один запит зазвичай = одне зображення. url — це data:image/... base64 (можна відкрити напряму або зберегти), fileName — стандартизоване ім\'я, яке треба скопіювати у Facebook «Ad name» для трекінгу.',
        },
        {
          kind: 'example',
          label: 'Успішна відповідь',
          body: `{
  "images": [
    {
      "url": "data:image/png;base64,....",
      "fileName": "creative_edit_<execution_id>.png"
    }
  ]
}`,
        },
        {
          kind: 'example',
          label: 'Помилка',
          body: `{
  "images": [],
  "error": "<human-readable error>",
  "raw": "<first 500 chars of upstream API response>"
}`,
        },
        {
          kind: 'note',
          title: 'Cost logging',
          text: 'Аналіз і рендер логуються у cost_log (n8n datatable) паралельно з відповіддю — не блокують юзера. Дивитись поточну вартість генерацій можна у Dashboard → Costs.',
        },
      ],
    },
    {
      id: 'ce-patterns',
      label: 'Коли Edit кращий за нову генерацію',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ідеальний банер з попередньої кампанії — а треба перекласти під новий GEO. Edit зберігає весь стиль, лише перекладає тексти.',
            'A/B на текстах — та сама композиція, різні хуки. Швидше і дешевше, ніж запускати весь Creatives-пайплайн з нуля.',
            'Дрібна візуальна правка — прибрати логотип, змінити колір кнопки, замінити фон — коли решта банера підходить.',
            'Рефреш креативу — коли банер вигорів у стрічці, але концепція жива. Edit «оновлює» його з мінімальним ризиком.',
          ],
        },
        {
          kind: 'warn',
          title: 'Коли Edit не спрацює',
          text: 'Якщо тобі треба кардинально перекомпонувати банер — інша сцена, інший persona, інша ідея кута — Edit тебе не порятує. Модель триматиметься за оригінал. У таких випадках йди у Creative Gen (генерувати з нуля) або в повний Creatives-пайплайн (з angle → concept).',
        },
      ],
    },
  ],
};

// ---------- FB → NB module (Megatool) ----------

const FB_TO_NB_MODULE: KBModule = {
  id: 'fb-to-nb',
  label: 'FB → NB',
  tagline: 'Мегатул для перенесення робочого оголошення з Facebook у Newsbreak: FB Campaign Reader → Binom Offer → NB Campaign, три кліки, один Binom URL і жива NB-кампанія на виході.',
  sections: [
    {
      id: 'fbnb-overview',
      label: 'Огляд',
      blocks: [
        {
          kind: 'p',
          text: 'Megatool — це окремий режим інтерфейсу (жовтий значок ⚡ у шапці). Він ховає звичайну навігацію (Keywords / Angles / Article / Creatives) і відкриває три послідовні вкладки, які разом виконують один сценарій: узяти живе оголошення з Facebook і перенести його у Newsbreak як окрему кампанію з правильним Binom-трекінгом.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'FB Campaign Reader', text: 'Вставляєш FB Campaign ID → бачиш усі активні адсети і оголошення з картинками, заголовками, tracking URL. Обираєш ті, з яких робимо NB-кампанію (перше = ЛІД для Binom).' },
            { title: 'Create Binom Offer', text: 'На основі trackingUrl обраного оголошення пайплайн клонує Binom-кампанію і всі її офери, переписує URL під NB (utm-и, event, макроси), реєструє офери у Newsbreak group. Отримуєш Binom Campaign URL — це click-through URL для NB.' },
            { title: 'Create NB Campaign', text: 'Готова секція під Binom-відповіддю. Обираєш NB account, bid strategy, розмір адсетів. Пайплайн завантажує креативи у NB, будує campaign → adsets → ads і повертає ID нової живої NB-кампанії.' },
          ],
        },
        {
          kind: 'note',
          title: 'Три вкладки — один flow, один state',
          text: 'Обраний FB-ад лежить у глобальному store. Форма Binom Offer і форма NB Campaign теж — тому можна перемикатися між вкладками, не втрачаючи поля. Fetch нової FB-кампанії скидає всю вибірку, Binom і NB state, щоб не сплутати дані.',
        },
      ],
    },
    {
      id: 'fbnb-fb-reader',
      label: 'Крок 1 — FB Campaign Reader',
      blocks: [
        {
          kind: 'p',
          text: 'Даєш ID кампанії з FB Ads Manager, натискаєш Fetch. Бекенд обходить Facebook Graph API v21.0 і повертає ієрархію campaign → adsets (тільки active за замовчуванням) → ads → creative.',
        },
        { kind: 'h3', text: 'Що бачиш у дереві' },
        {
          kind: 'kv',
          rows: [
            { k: 'Campaign header', v: 'Ім\'я, ID, objective, account, daily / lifetime budget, effective_status як бейдж.' },
            { k: 'Adsets', v: 'Розбиті на «Активні» і «Неактивні / На паузі». Кожен блок — optimization goal, бюджет, кількість оголошень.' },
            { k: 'Ads', v: 'Картки: превʼю (image / thumbnail / video source), title, body (з more/less), CTA type, tracking URL. Video-креативи мають бейдж ▶ Video.' },
            { k: 'Tracking URL', v: 'Витягається з link_url → object_story_spec.link_data.link → …call_to_action.value.link. Якщо жоден не дав ULR — картка позначається «немає tracking URL — Binom flow недоступний».' },
          ],
        },
        { kind: 'h3', text: 'Як обирати оголошення' },
        {
          kind: 'list',
          items: [
            'Клік по картці — додає в вибірку. Повторний клік — забирає.',
            'ПЕРШЕ обране = ЛІД. Саме з його trackingUrl створюється Binom Offer (звідти беремо ключ, landing, tracker).',
            'Обрано 1 → Binom Offer + NB Campaign з одним оголошенням.',
            'Обрано 2+ → той самий Binom Offer (за лідом) + NB Campaign, де всі обрані стають окремими оголошеннями і розкидаються по адсетах (макс 4 на адсет: 5→3+2, 6→3+3, 7→4+3, 8→4+4).',
          ],
        },
        { kind: 'h3', text: 'Що робить бекенд' },
        {
          kind: 'kv',
          rows: [
            { k: 'Endpoint', v: 'POST /megatool-fb-campaign-reader' },
            { k: 'API', v: 'Facebook Graph API v21.0 (graph.facebook.com)' },
            { k: 'Token probe', v: 'Пул access-токенів — пробує дешевий ID-lookup на кожному, перший, що працює, — використовується для всього обходу.' },
            { k: 'Retry', v: 'Exponential backoff (2^n) для rate-limit кодів 4, 17, 32, 613 і subcode 2446079.' },
            { k: 'Video resolution', v: 'Для video creatives підтягуємо .mp4 URL через video_id → video_source_url. Живе кілька хвилин — саме тому Create NB Campaign завантажує його одразу, а не «на потім».' },
          ],
        },
        {
          kind: 'tip',
          title: 'Кнопка Copy raw JSON',
          text: 'Праворуч зверху — «Copy raw JSON». Дає повний dump відповіді, який можна вкинути у скрипт або debug — корисно, якщо треба руками витягти якесь поле, або якщо на картці чогось не видно, а в API воно є.',
        },
      ],
    },
    {
      id: 'fbnb-binom',
      label: 'Крок 2 — Create Binom Offer',
      blocks: [
        {
          kind: 'p',
          text: 'Кнопка «→ Create Binom Offer» відкриває другу вкладку. Тут ти вказуєш параметри для NB-кампанії (NB account, tracking event, bid strategy) і Binom-специфічні опції (AMO домен, канал, група). При натисканні Submit бекенд клонує ВСЮ Binom-кампанію оригінального оголошення і переписує URL під Newsbreak.',
        },
        { kind: 'h3', text: 'Поля форми' },
        {
          kind: 'kv',
          rows: [
            { k: 'NB Account *', v: 'Комбобокс з ~430+ NB акаунтів (з датетаблиці nb_accounts). Обирається один — далі під нього тягнеться список events.' },
            { k: 'Tracking event', v: 'Auto-pick: complete_payment для TARGET_ROAS / TARGET_CPA, click_button для MAX_CONVERSION. Можна перевизначити вручну. event= у Binom-URL береться саме звідси.' },
            { k: 'Bid Type *', v: 'MAX_CONVERSION (дефолт), TARGET_CPA (з полем Bid Rate у $), TARGET_ROAS (з полем ROAS Target %). TARGET_ROAS доступний ТІЛЬКИ коли event = complete_payment.' },
            { k: 'New AMO domain', v: 'Новий landing-домен. «same» = лишити оригінальний. Якщо змінюєш — Binom викликає AMO API (amo-p.com), клонує статтю на новий домен і підмінює URL офера.' },
            { k: 'New AMO channel', v: 'Опційний label каналу — просто додається до імені офера, не до URL.' },
            { k: 'New Binom group', v: 'До якої групи Binom кинути нові офери. Комбобокс тягне з датетаблиці binom_groups за поточним tracker\'ом. «same» = лишити.' },
            { k: 'Tracker', v: 'ilab.nnctrack.com / jaguars.nnctrack.com / sharks.nnctrack.com. Автовизначається з домена оригінального trackingUrl, можна перевизначити.' },
            { k: 'Binom Campaign Name', v: 'Автоскладене: [ROAS | ]<base> | US | NB | <NB account> | MEGATOOL | DD.MM.YYYY. Base = ім\'я оригінальної FB-кампанії (або NB campaign name, якщо вже введено). Можна редагувати руками.' },
          ],
        },
        {
          kind: 'note',
          title: 'binom_groups і amo_domains — де вони живуть',
          text: 'Це n8n datatables на n8n.nnctrack.com (проєкт Eq7a31TbjRZLdTAw). binom_groups — назва → UUID → tracker (та сама назва може існувати у різних трекерів з різними UUID). amo_domains — відомі AMO домени, використовуються для очистки старих суфіксів у назві офера перед додаванням нового «| New AMO <domain>».',
        },
        { kind: 'h3', text: 'Що робить бекенд' },
        {
          kind: 'steps',
          items: [
            { title: 'Read binom_groups', text: 'Тягне всю таблицю — для lookup «name → UUID» за обраним tracker.' },
            { title: 'Probe Binom API keys', text: 'Оригінальний trackingUrl містить key — пайплайн пробує всі відомі Binom API-ключі поспіль, перший, що може прочитати кампанію по цьому key, — правильний.' },
            { title: 'Clone campaign + offers', text: 'GET /campaign/<id>/clone і для кожного офера GET /offer/<id>/clone. На виході — шаблон з новими UUID.' },
            { title: 'Rewrite offer URL', text: 'Стирає старі query-параметри і вкидає NB-параметри: m=og, part=bol, utm_source=newsbreak, utm_medium=gs, newsbreak_cid={t10}, term1={clickid}_{campaign_id}[_roas], term2={campaign_domain}, ad_id={t2}. Підклад для ROAS-варіанта — суфікс _roas.' },
            { title: 'Rewrite offer name', text: 'Стирає відомі AMO-доменні мітки з imya, додає «New CH = <channel>» і «New AMO <domain>» якщо ти вказав.' },
            { title: 'AMO domain swap (якщо потрібно)', text: 'GET /articles/<id> → POST /articles на новий домен → підміна article URL у офері.' },
            { title: 'Create offers on Binom', text: 'POST /offer для кожного трансформованого офера. Далі POST /offer/change_group переносить їх у hardcoded Newsbreak group UUID (окремий для кожного tracker\'а).' },
            { title: 'Find NB traffic source', text: 'GET /traffic_source/list/filtered → пошук за назвою «newsbreak» / «nb». ID cwapується у шаблон кампанії.' },
            { title: 'Create campaign', text: 'POST /campaign з новим key, ім\'ям (з MEGATOOL міткою), remapped offer ID, NB traffic source. Повертає binomCampaignId + binomCampaignUrl.' },
          ],
        },
        { kind: 'h3', text: 'Що повертається' },
        {
          kind: 'example',
          label: 'Успішна відповідь (укорочено)',
          body: `{
  "ok": true,
  "tracker": "ilab.nnctrack.com",
  "binomCampaignId": "<uuid>",
  "binomCampaignUrl": "https://ilab.com/click.php?key=...&creative_name=__CREATIVE_NAME__&...",
  "binomCampaignName": "ROAS | Original | US | NB | acct | MEGATOOL | 05.07.2026",
  "binomOfferIds": ["<uuid1>", "<uuid2>"],
  "offerGroupChange": { "attempted": true, "ok": true, ... }
}`,
        },
        {
          kind: 'warn',
          title: 'Макроси у click URL — __DOUBLE_UNDERSCORE__, а не {curly}',
          text: 'На відміну від Binom-контекстів, де стандарт — {clickid} / {t1}, click URL для NB використовує __CREATIVE_NAME__, __CAMPAIGN_ID__, __FLIGHT_ID__, __OS__, __PLACEMENT__ тощо. Це формат макросів самого Newsbreak. Якщо переставляєш URL руками — не «виправляй» подвійні підкреслення на кучеряві дужки.',
        },
      ],
    },
    {
      id: 'fbnb-nb',
      label: 'Крок 3 — Create NB Campaign',
      blocks: [
        {
          kind: 'p',
          text: 'Секція «Create NB Campaign» рендериться прямо в цій же вкладці, під результатом Binom. Більшість полів уже підтягнулися з попередніх кроків (NB account, click-through URL = Binom Campaign URL, ad-контент з обраних FB-оголошень). Тобі лишається задати budget, start date і структуру адсетів.',
        },
        { kind: 'h3', text: 'Поля форми' },
        {
          kind: 'kv',
          rows: [
            { k: 'Campaign Name', v: 'Ім\'я NB-кампанії — за замовчуванням наслідує Binom, можна редагувати.' },
            { k: 'Budget (daily USD)', v: 'Daily budget адсету. Пайплайн множить на 100 для NB (мінорні одиниці).' },
            { k: 'Start Date', v: 'now+3h / tomorrow / tomorrow+1 / tomorrow+2. Пайплайн обчислює startTime з урахуванням timezone (now+3h — відносно поточного моменту, timezone не впливає).' },
            { k: 'Start Timezone', v: 'PDT (00:00 PDT) або EEST (14:00 PDT — це той самий момент, що ранок EEST).' },
            { k: 'Bid Type + Bid Rate / ROAS', v: 'Успадковуються з Binom Offer форми. TARGET_ROAS має пріоритет — якщо roas > 0, він виграє над TARGET_CPA. Trackingid все одно передається у всіх режимах.' },
            { k: 'Adset sizes', v: 'Масив цифр, який каже, як розкидати обрані оголошення по адсетах. Приклад: 4 обраних + adsetSizes=[2,2] → 2 адсети по 2 оголошення. Сума має дорівнювати кількості обраних оголошень.' },
            { k: 'Brand name / CTA', v: 'Успадковуються з FB creative, можна перевизначити. NB вимагає brandName і callToAction на кожному ad.' },
          ],
        },
        { kind: 'h3', text: 'Що робить бекенд' },
        {
          kind: 'steps',
          items: [
            { title: 'Validate & Prepare', text: 'Перевіряє все — nbAccountId у датетаблиці, clickThroughUrl, ads[], сума adsetSizes == ads.length, кожен ad має headline+body+assetUrl. Далі виникає один item на кожен ad для fanout.' },
            { title: 'Download Asset', text: 'HTTP GET на assetUrl кожного ad (це FB CDN URL / video_source_url). У пам\'ять як binary.' },
            { title: 'Upload Asset to NB', text: 'POST /ad/uploadAssets — multipart, 3 retry по 2s. Повертає CDN URL Newsbreak, який далі йде у creative.assetUrl. Тип: IMAGE / VIDEO (за розширенням) / GIF.' },
            { title: 'Create Chain', text: 'Chain оркеструє все: POST /campaign/create (objective=WEB_CONVERSION), потім POST /ad-set/create по одному на кожен бакет з adsetSizes (bid strategy, budget*100, targeting all/all/all, platforms=[NEWSBREAK]), потім POST /ad/create по одному на кожне оголошення з відповідним uploaded assetUrl.' },
            { title: 'Respond', text: 'Повертає campaignId, adsetIds[], adIds[], assetUrls[]. Помилка на будь-якому кроці — повертає step: input/validateAccount/pairAssets/uploadAsset/createCampaign/createAdset/createAd, щоб було зрозуміло, де впало.' },
          ],
        },
        {
          kind: 'note',
          title: 'Targeting завжди all/all/all',
          text: 'Newsbreak-кампанії, які створює megatool, ідуть без таргетингу: gender/age/interest/location/deviceLocation/language/os/manufacturer/carrier/network = all. Platform: тільки NEWSBREAK. Якщо треба інше — редагуй кампанію вже у NB UI після створення; megatool навмисно не лізе у targeting, щоб не приймати рішень за байєра.',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'Endpoint', v: 'POST /megatool-create-nb-campaign' },
            { k: 'Datatable', v: 'nb_accounts (k3d1smfnWc9VP0cq) — Account Name → Account ID' },
            { k: 'Aux endpoints', v: 'POST /megatool-list-nb-accounts (dropdown), POST /megatool-fetch-nb-events (event picker)' },
            { k: 'NB API base', v: 'https://business.newsbreak.com/business-api/v1' },
          ],
        },
      ],
    },
    {
      id: 'fbnb-data',
      label: 'Дані, які ходять між кроками',
      blocks: [
        {
          kind: 'p',
          text: 'Три вкладки — це не три ізольовані інструменти. Один state дає більше зчеплення, ніж може здатися. Ось що саме перетікає з кроку в крок:',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'FB Reader → Binom', v: 'trackingUrl (з обраного ad), campaignName / adName / creativeTitle (для авто-імені Binom-кампанії), thumbnailUrl і adsetName / campaignName (для summary-картки в Binom формі).' },
            { k: 'Binom form → Binom pipeline', v: 'newAmoDomain, newAmoChannel, newBinomGroup, tracker, isRoas (derived з bidType===TARGET_ROAS), binomCampaignName, nbEventType (з event picker).' },
            { k: 'Binom result → NB form', v: 'binomCampaignUrl → clickThroughUrl. binomCampaignName → NB campaignName default.' },
            { k: 'FB Reader → NB form', v: 'Обрані ads → ads[] масив (adName, headline=creativeTitle, body=creativeBody, assetUrl=asset URL з відео resolution або thumbnail).' },
            { k: 'NB form → NB pipeline', v: 'nbAccountId, campaignName, budget, startDate, startTimezone, bidType/bidRate/roas, trackingId, ads[], adsetSizes[].' },
          ],
        },
        {
          kind: 'warn',
          title: 'Fetch нової FB-кампанії = повний reset',
          text: 'Коли ти вставляєш інший Campaign ID і тиснеш Fetch — Create Binom Offer скидається повністю, як при першому відкритті: clearSelectedFbAd + closeBinomOffer + resetBinomOffer + resetBinomForm + closeNbCampaign + resetNbCampaign + resetNbForm + resetTtCampaign + resetTtForm. Зберігається лише DESTINATION (його обирають на цій же вкладці). Це навмисно: інакше в Binom / NB форму заповзуть tracker / group / назва кампанії / хедлайни з попередньої кампанії. Якщо хочеш зберегти проміжок — скопіюй Binom URL кудись у нотатки перед fetch.',
        },
      ],
    },
    {
      id: 'fbnb-troubleshoot',
      label: 'Типові збої і що з ними робити',
      blocks: [
        {
          kind: 'kv',
          rows: [
            { k: '«немає tracking URL»', v: 'У FB creative не витягся link. Найчастіше — CBO-кампанія без прямого лінку. Обери інше оголошення або зайди у FB Ads Manager і перевір, чи у ad є Website URL.' },
            { k: 'Binom offer clone впав', v: 'Ключ, який пробували, не пасує до цього tracker\'а. Пайплайн повертає {ok:false, error:...}. Перевір, чи tracker у формі відповідає домену tracking URL.' },
            { k: '«В акаунті немає подій»', v: 'У NB акаунті просто нема жодного tracking event. Пайплайн падає на fallback (перший available у списку). Ти можеш обрати інший акаунт або одразу створити event у NB UI.' },
            { k: 'TARGET_ROAS сірий', v: 'Обраний event ≠ complete_payment. Або перевибери event, або опустися до MAX_CONVERSION / TARGET_CPA.' },
            { k: 'NB Upload asset впав', v: 'Іконка Video-креативу — video_source_url з FB живе кілька хвилин. Якщо ти обрав ad, а потім кілька хвилин думав — може протухнути. Fetch кампанії ще раз і одразу шли у NB.' },
            { k: 'Кампанія створена, але без ads', v: 'Дивись step у відповіді. Найчастіше — createAd впав з {step:"createAd"}. Кампанія і адсети вже живі у NB — треба або доробити ads руками у NB UI, або видалити кампанію і повторити.' },
          ],
        },
      ],
    },
  ],
};

// ---------- CREATIVE EDIT — CHANGE APPROACH module ----------

const CREATIVE_EDIT_APPROACH_MODULE: KBModule = {
  id: 'creative-edit-approach',
  label: 'Creative Edit (Change Approach)',
  tagline: 'Режим Change Approach: AI аналізує оригінальний банер + статтю, пропонує 5 повністю нових ідей (Hook / Accent / CTA / Title / Description) з різними механіками — обираєш одну і рендериш банер зі збереженням композиції оригіналу.',
  sections: [
    {
      id: 'cea-overview',
      label: 'Огляд',
      blocks: [
        {
          kind: 'p',
          text: 'Change Approach — це протилежність Change Image. Change Image міняє слова, лишає ідею. Change Approach міняє ІДЕЮ, лишає композицію. Використовуй, коли поточний банер вже втомлений і потрібно перепридумати кут атаки — а не просто підкрутити текст.',
        },
        {
          kind: 'p',
          text: 'Флоу — три колонки, як в Angles. У 1-й вкидаєш оригінальний банер + статтю (URL / Title / Description). AI розкладає оригінал на складові, читає статтю, вигадує 5 РІЗНИХ ідей (кожна з окремою механікою — Question, Myth-busting, Direct, Story, Curiosity, Eligibility-first) і повертає їх у 2-у колонку. Обираєш одну — і 3-я колонка рендерить банер із новими текстами на композиції оригіналу.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'Upload creative + fill Article', text: 'Оригінальний банер + Article URL + поточні Title / Description. Опційно: Analyze image, щоб автозаповнити поточні Hook / Accent / CTA (це важливо — див. секцію «Composition preservation»).' },
            { title: 'Generate New Ideas', text: 'Тригерить 3-агентний пайплайн (Analyst → Strategist → Copywriter). Повертається 5 повних креативних сетів у 2-й колонці. ~30–60 сек.' },
            { title: 'Pick one idea', text: 'Клік по картці — обирається один сет. Кожен сет має Hook / Accent / CTA / Title / Description + мітку механіки + compliance-статус (safe / watch).' },
            { title: 'Generate Creative', text: 'Рендерить банер image-to-image edit: оригінал + нові тексти на місці старих. Композиція, фон, стиль — зберігаються. Title / Description показуються ПІД банером окремим текстом, НЕ рендеряться на самому зображенні.' },
          ],
        },
        {
          kind: 'note',
          title: 'Чому саме 5 ідей',
          text: 'Copywriter (Agent 3) має лише 4 доступні hook-формули (F2 / F3 / F4 / F6 — F1 і F5 deprecated для RSOC). При N=5 п\'ятий креатив обов\'язково приходить із іншого aspect_category — це тримає різноманіття без формульної колізії. Більше 5 → починає дублювати механіки; менше 5 → недостатньо кутів для A/B.',
        },
      ],
    },
    {
      id: 'cea-inputs',
      label: 'Поля, які ти заповнюєш',
      blocks: [
        {
          kind: 'kv',
          rows: [
            { k: 'Mode', v: 'Change Approach — двокнопковий toggle на самому верху першої колонки. Change Image / Change Approach. За замовчуванням Change Image.' },
            { k: 'Creative image *', v: 'PNG / JPG / WebP. Той самий upload, що й у Change Image. Оригінальний банер, композицію якого треба зберегти.' },
            { k: 'Article URL *', v: 'URL статті, з якої AI буде розуміти intent і compliance-межі. Тільки URL — paste article text не підтримується (backend тягне через Jina.ai).' },
            { k: 'Title *', v: 'Поточний ad title (той, що зараз стоїть у Ads Manager). AI використовує його як сигнал того, що обіцяла попередня версія креативу.' },
            { k: 'Description *', v: 'Поточний ad description. Разом із Title формує «поточний контекст», від якого AI відштовхується, генеруючи нові варіанти.' },
            { k: 'Aspect ratio *', v: '1:1 / 16:9 / 9:16 / 4:5. Passthrough до фінального рендеру. Change Approach не міняє пропорції оригіналу — параметр лишається для конзистентності з Change Image.' },
            { k: 'Language', v: '«Keep original language» (дефолт) — рендер лишається у мові оригіналу. Обери конкретну мову, щоб Agent 3 одразу генерував нові тексти в ній.' },
            { k: 'Hook / Accent / CTA', v: 'Опційні. Заповнюються Analyze-кнопкою — це «поточний стан оригіналу», а НЕ бажаний результат. Використовується для composition preservation (див. окрему секцію).' },
          ],
        },
        {
          kind: 'warn',
          title: 'Article URL має бути публічно доступним',
          text: 'Jina.ai (r.jina.ai) фетчить статтю з публічного інтернету. Якщо URL за paywall, JS-only render, чи геоблоком — фетч поверне порожньо або HTML-shell. Тоді Agent 1 працюватиме тільки на Title + Description без справжнього article context — якість ідей просяде. Перевір URL у інкогніто перед запуском.',
        },
        {
          kind: 'tip',
          title: 'Analyze — не обов\'язково, але сильно рекомендую',
          text: 'Change Approach працює без Analyze — Agent 3 сам провидить ідеї. Але якщо ти НЕ запустив Analyze, backend не знатиме, які саме текстові позиції були на оригінальному банері — і фінальний рендер може додати Accent / CTA, яких там не було. Запусти Analyze один раз перед Generate Ideas — це дешевий крок (одна vision-модель, ~1 сек).',
        },
      ],
    },
    {
      id: 'cea-pipeline',
      label: 'Крок 1 — Generate New Ideas (3-агентний пайплайн)',
      blocks: [
        {
          kind: 'p',
          text: 'Клік «Generate New Ideas» тригерить POST на /creative_approach_ideas. Backend послідовно робить чотири речі: (1) Vision Decompose читає оригінальний банер, (2) Jina.ai тягне текст статті, (3) Agent 1 → Agent 2 → Agent 3 генерують ідеї. Фінальний вивід — 5 креативів у shape, який очікує фронт.',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'Endpoint', v: 'POST /creative_approach_ideas (n8n-nodes-base.webhook, responseMode: lastNode)' },
            { k: 'Article fetch', v: 'https://r.jina.ai/{{articleUrl}} — plain-text reader від Jina.ai. onError: continueRegularOutput, тож fail не валить пайплайн (Agent 1 працює на Title/Description як fallback).' },
            { k: 'Vision Decompose', v: 'anthropic/claude-opus-4.7 через OpenRouter. Читає оригінал і повертає JSON: {mechanic, tone, formula_detected, current_promises[], banned_words_used[]}. Задача — сказати Agent 1, звідки стартуємо.' },
            { k: 'Latency', v: '~30–60 сек end-to-end. Три Opus 4.7 виклики послідовно, плюс Jina fetch. Fronted показує skeleton loader.' },
          ],
        },
        { kind: 'h3', text: 'Vision Decompose' },
        {
          kind: 'prompt',
          label: 'Vision Decompose — system prompt',
          model: 'anthropic/claude-opus-4.7',
          body: `Analyze this currently-live creative banner so we can design a fundamentally DIFFERENT approach.

Return ONLY a JSON object with keys:
- mechanic: one of F2 Surprise, F3 Question, F4 Number, F6 Contrast, Story, Direct, Eligibility
- tone: one of soft, direct, mixed
- formula_detected: short phrase naming the persuasion pattern (e.g. "question hook + eligibility marker")
- current_promises: 3–6 short strings summarising the concrete claims the banner asserts
- banned_words_used: any §12 substitution-table words visibly rendered (free, cash, win, guarantee, save big, etc.)

No prose, no markdown fences.`,
        },
        { kind: 'h3', text: 'Agent 1 — Marketing Analyst' },
        {
          kind: 'p',
          text: 'Копія Agent 1 з Hooks-Image Generator (той самий verbatim system prompt, у KB — коротка версія). Задача: розкласти input на структуровану аналітику для Agent 2.',
        },
        {
          kind: 'prompt',
          label: 'Agent 1 (Marketing Analyst) — summary prompt',
          model: 'anthropic/claude-opus-4.7',
          body: `You are Marketing Analyst for the RSOC creative pipeline.
Input: Vision Decompose output + article headline / first paragraph + current Title / Description.
Task: produce structured JSON for downstream Strategist / Copywriter.

Primary signal is what the cold Meta user will click on the landing page. Article teaser is supporting context only — do not invent article content beyond it.

Return JSON with:
- keyword_intent: { core_need, qualifier, intent_modifier, reasoning }
- content_promise: { main_promise, curiosity_angle, emotional_payoff }
- bridge_point: 1 sentence, 15–25 words, joining core_need + main_promise
- audience_clusters: exactly 3 HOT facets of the same keyword user (no proxy personas, no weak filler)
- content_anchors: 3–5 concrete nouns actually referenced in the article teaser
- compliance_note: 1 string flagging §7 Location / §10 Personal / §11 Aggression / §14 Invented specifics risks

No prose outside the JSON.`,
        },
        { kind: 'h3', text: 'Agent 2 — Strategist (top-1)' },
        {
          kind: 'p',
          text: 'Оригінально видає 3 angles під HITL-вибір. У Change Approach модифікація: інструкція «output exactly 1 angle in the angles array» (топ-1 за trigger-fitness). Agent 3 читає angles[0]. Навіть якщо модель випадково поверне 3, downstream бере тільки перший.',
        },
        {
          kind: 'prompt',
          label: 'Agent 2 (Strategist, top-1) — summary prompt',
          model: 'anthropic/claude-opus-4.7',
          body: `You are Strategist for the RSOC creative pipeline.
Input: Agent 1 output. Task: pick the ONE strongest cognitive trigger and return a single change-of-approach angle for Agent 3.

Cold Meta pool is mostly L1 Unaware / L2 Problem-Aware. Angle must create curiosity the article partially resolves — never give the full answer upfront.

Choose ONE trigger from:
  CG Curiosity Gap, SR Self-Reference, LA Loss Aversion, PI Pattern Interrupt, BS Belief Shift.
(AU Authority is deprecated. Reject LA if no clear missed benefit, BS if no identifiable belief, SR if audience too broad.)

Return ONLY:
{"angles":[{code, trigger, direction (15–25 words, strategy not headline), awareness_level (L1|L2), belief_being_shifted (only for BS), emotional_anchor (Discovery|Hope|Relief|Concern|Pride|Indignation|Confidence|Curiosity), why_works, why_this_works (25–40 word guardrail), hook_seed (8–12 words)}], "operator_note":"..."}

Comply with §7 / §10 / §11 / §14. Exactly 1 angle. No prose, no fences.`,
        },
        { kind: 'h3', text: 'Agent 3 — Copywriter (N=5)' },
        {
          kind: 'p',
          text: 'Копія Agent 3 з модифікацією «3 creatives → 5 creatives». Уся compliance-механіка (§7 / §10 / §11 / §12 / §14 бани, §12 substitution table, formula-trigger compatibility matrix, aspect-pool brainstorm через 8 категорій, read-aloud test) лишається verbatim з оригіналу. Ця частина промта — роки навчання на реальних disapprovals, її не чіпаємо.',
        },
        {
          kind: 'prompt',
          label: 'Agent 3 (Copywriter, N=5) — summary prompt',
          model: 'anthropic/claude-opus-4.7',
          body: `You are Copywriter for the RSOC creative pipeline.
Input: chosen angle from Agent 2 + Agent 1 audience/anchors. Task: produce EXACTLY 5 banner creatives, each with a distinct aspect_category (from the 8-category library).

Formulas — pick per creative from the trigger-compatibility whitelist:
  CG → F2 / F3 / F4 / F6
  SR → F2 / F3 / F4
  LA → F2 / F3 / F4
  PI → F2 / F3 / F4
  BS → F2 / F4 / F6
(F1 Problem and F5 Story are deprecated for RSOC.)

Compliance — banned in hook / accent / cta / meta_title / meta_copy:
  §7 Location ("near me / local"), §10 Personal ("your X / are you"),
  §8 Transactional CTA ("Apply Now / Get Started"), §11 Aggression ("act fast / don't miss out"),
  §12 Transactional Claims ("free / cash / win / save big / guarantee"), §14 Invented specifics.

§12 substitution table — swap banned SEO vocab:
  free → no-cost / through nonprofits / covered by
  cash → financial help / monthly assistance
  win → qualify for / receive / be considered for
  save big → lower-cost / reduced rates

meta_ad_copy MUST end with "Read Guide" if banner_cta == "Read Guide", else with "Read Article".

Return ONLY: {"creatives":[{creative, formula, aspect_tested, aspect_category, banner_hook, banner_accent, banner_cta, meta_ad_title, meta_ad_copy} × 5]}. No prose, no fences.`,
        },
        {
          kind: 'note',
          title: 'Compliance risk badge на картках ідей',
          text: 'Frontend сканує Agent 3 output на §12-substitution vocab («no-cost», «through nonprofits», «qualify for», «lower-cost»…). Якщо знайшов — картка отримує тег «watch» замість «safe». Це не помилка — це сигнал, що Copywriter довелось перефразувати з banned SEO-вокабуляра. Значення: креатив легальний, але кут ризикованіший — тримай як тестовий, не основний.',
        },
      ],
    },
    {
      id: 'cea-generate',
      label: 'Крок 2 — Generate Creative (з композицією оригіналу)',
      blocks: [
        {
          kind: 'p',
          text: 'Клік «Generate Creative» після вибору картки шле POST на /creative_approach_generate. Backend бере оригінальний банер + hook/accent/cta з обраної ідеї і робить image-to-image edit — той самий Gemini 3-pro-image-preview, що і в Change Image. Різниця — жорстка перевірка на «які позиції взагалі існують на оригіналі».',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'Endpoint', v: 'POST /creative_approach_generate' },
            { k: 'Model', v: 'google/gemini-3-pro-image-preview' },
            { k: 'Editing style', v: 'SURGICAL EDIT — 5 жорстких правил: (1) ERASE all original text first, (2) render only strings on Text-to-render lines, (3) empty positions have no text, (4) change only what is named, (5) NEVER render meta_title / meta_copy на банер (вони caption під ним).' },
            { k: 'Response shape', v: '{ url, fileName, title, description } — title/description echo-нуться назад з обраної ідеї для caption під зображенням.' },
          ],
        },
        {
          kind: 'prompt',
          label: 'Generate Image — static editing rules (RULE 1–5)',
          model: 'google/gemini-3-pro-image-preview',
          body: `Surgically edit the attached banner. Preserve composition, background, style, lighting, logos.

RULE 1 — ERASE ALL ORIGINAL TEXT FIRST before rendering anything new.
RULE 2 — RENDER ONLY the exact strings listed on Text-to-render lines, verbatim.
RULE 3 — POSITIONS IN THE ERASE LIST STAY EMPTY (no ghost text, no empty button shell).
RULE 4 — CHANGE ONLY WHAT IS NAMED. Do not add or move elements the render / erase lists don't mention.
RULE 5 — NEVER render meta_title or meta_copy on the image. Those are UI caption below the banner, not banner pixels.

The RENDER LIST and ERASE LIST below are built dynamically from the picked idea and the presentSlots map.`,
        },
        { kind: 'h3', text: 'Composition preservation (present slots rule)' },
        {
          kind: 'p',
          text: 'Ключове правило: якщо оригінальний банер мав ТІЛЬКИ Hook (без Accent, без CTA-кнопки), то edited-версія теж має мати тільки Hook. AI не має права додати Accent-рядок і CTA-кнопку, яких не було. Це реалізовано через `presentSlots` boolean-мапу.',
        },
        {
          kind: 'kv',
          rows: [
            { k: 'presentSlots на frontend', v: 'Виводиться зі стану Hook/Accent/CTA полів (заповнюються Analyze). Порожнє поле → false («слот відсутній на оригіналі»). Непорожнє → true.' },
            { k: 'Обробка на backend', v: 'Extract Binary node перед Generate Image робить intersect: idea.hook лишається тільки якщо presentSlots.hook === true. Інакше — обнуляється, і prompt-генератор ставить цю позицію у ERASE list (де стирати нічого — no-op).' },
            { k: 'Fallback', v: 'Якщо frontend НЕ передав presentSlots (старий payload) — backend дивиться на `original.hook/accent/cta`: непорожні рядки = present, порожні = absent. Якщо взагалі нічого не прийшло — default «all present» (не регресує старий флоу).' },
          ],
        },
        {
          kind: 'example',
          label: 'Приклад: оригінал має тільки Hook',
          body: `Frontend state (після Analyze):
  hook   = "HOW CENTRELINK HOME BUYING WORKS"
  accent = ""
  cta    = ""

Frontend payload:
  original      = { hook: "HOW CENTRELINK…", accent: "", cta: "" }
  presentSlots  = { hook: true,  accent: false, cta: false }
  idea          = { hook: "Pension Income Can Count…",
                    accent: "Housing Australia Backed Pathways",
                    cta: "Learn More", title: "…", description: "…" }

Extract Binary → Generate Image:
  hook   = "Pension Income Can Count…"   (kept, slot present)
  accent = ""                              (dropped, slot absent)
  cta    = ""                              (dropped, slot absent)

Editing prompt:
  RENDER LIST: HOOK position → "Pension Income Can Count…"
  ERASE LIST:  ACCENT position, CTA button (nothing to erase on
                original — no-op, no ghost, no empty button shell)

Result:
  Banner has only Hook (нова текстівка на тій самій композиції).
  Title/Description показуються ПІД банером окремим текстом у UI.`,
        },
        {
          kind: 'warn',
          title: 'Meta title / description НЕ рендеряться на банер',
          text: 'RULE 5 у promt Generate Image явно забороняє додавати title/description на зображення. Вони — caption-текст під банером у UI. Це навмисно: title/description йдуть у Ads Manager як окремі поля, а не як частина зображення. Якщо колись побачиш їх пропечені на банері — це промт-drift, треба тюнити RULE 5.',
        },
      ],
    },
    {
      id: 'cea-vs-change-image',
      label: 'Change Approach vs Change Image',
      blocks: [
        {
          kind: 'kv',
          rows: [
            { k: 'Change Image', v: 'Тексти вже придумав, треба їх ЗАМІНИТИ на банері. Один webhook, один рендер, ~15–25 сек. Оригінальні тексти й нові — з твоєї голови.' },
            { k: 'Change Approach', v: 'Тексти треба ПРИДУМАТИ з нуля з різних кутів. Три послідовні LLM-виклики + рендер, ~30–60 сек + ~15 сек = 45–75 сек end-to-end. Оригінальні тексти вже стоять на банері, нові вигадує AI на основі статті.' },
            { k: 'Коли брати Change Image', v: 'Знаєш, який має бути новий Hook / Accent / CTA. Просто підмінити. Або переклад на іншу мову.' },
            { k: 'Коли брати Change Approach', v: 'Банер вже втомлений, треба нова ідея. Або хочеш побачити, які кути AI вигадає під ту саму статтю. Або A/B-тестуєш різні cognitive triggers на тому самому візуалі.' },
          ],
        },
        {
          kind: 'tip',
          title: 'Composition preservation — спільне для обох режимів',
          text: 'Обидва режими зберігають композицію оригіналу — фон, стиль, шрифт, розміри. Різниця в тому, ЩО ти даєш як «нові тексти»: у Change Image — руками, у Change Approach — AI генерує 5 варіантів.',
        },
      ],
    },
    {
      id: 'cea-troubleshooting',
      label: 'Troubleshooting',
      blocks: [
        {
          kind: 'kv',
          rows: [
            { k: 'Ідеї всі схожі одна на одну', v: 'Agent 3 повинен був відхилити такий output через STEP 4A hook diversity check. Якщо все ж таки — можливо, стаття надто вузька (Agent 1 повернув слабі audience_clusters). Дай ширшу статтю або підправ Title/Description так, щоб вони натякали на ширший intent.' },
            { k: 'Всі 5 ідей — «watch» compliance', v: 'Стаття або keywords тягнуть §12 vocab (free / cash / win). Agent 3 не має вибору, окрім substitution. Це ОК — рендер легальний, тримай як тест pool, а не основний залив.' },
            { k: 'Banner після рендеру має Accent / CTA, яких не було на оригіналі', v: 'presentSlots не спрацював. Перевір: (a) чи запустив Analyze перед Generate Ideas — щоб hook/accent/cta заповнились коректно; (b) чи frontend не кеше старий payload (hard reload). Якщо стабільно — переконайся, що новий Extract Binary node в n8n імпортований (стара версія не знає про presentSlots).' },
            { k: 'Title / Description з\'явились на самому банері', v: 'Prompt-drift на Generate Image. RULE 5 має це блокувати. Якщо повторюється — підсиль RULE 5 більш прямими словами («NEVER add ANY text below or beside the CTA / hook — meta fields do not appear on the image, period»).' },
            { k: 'Latency > 90 сек', v: 'Три Opus 4.7 виклики + Jina fetch. Якщо стабільно повільно — перевір OpenRouter status; можна тимчасово перевести Agent 2 на sonnet-4.6 (Strategist потребує менше «мозку», ніж Analyst і Copywriter).' },
          ],
        },
      ],
    },
  ],
};

const MODULES: KBModule[] = [
  KEYWORDS_MODULE,
  ANGLES_MODULE,
  ARTICLE_MODULE,
  CREATIVES_MODULE,
  CREATIVE_GEN_MODULE,
  CREATIVE_EDIT_MODULE,
  CREATIVE_EDIT_APPROACH_MODULE,
  FB_TO_NB_MODULE,
];

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

const resizeImageToJpegDataUrl = (file: File, maxPx: number, quality: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') { reject(new Error('FileReader returned non-string')); return; }
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas 2d unavailable')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });

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
  const [draftImage, setDraftImage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

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
    setDraftImage('');
    setImageError(null);
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
        image: draftImage,
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
    setDraftImage(p.image ?? '');
    setImageError(null);
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

  const handleImageFile = async (file: File) => {
    setImageError(null);
    try {
      const dataUrl = await resizeImageToJpegDataUrl(file, 480, 0.8);
      setDraftImage(dataUrl);
    } catch (e) {
      setImageError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImageDragEnter = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleImageDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleImageDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleImageFile(file);
  };
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageFile(file);
    e.target.value = '';
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
                  <div className="flex items-center gap-2">
                    {p.image && (
                      <img
                        src={p.image}
                        alt=""
                        className="w-8 h-8 shrink-0 object-cover rounded border"
                      />
                    )}
                    <div className="font-semibold text-sm truncate" title={p.name}>
                      {p.name}
                    </div>
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

        <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
          Creative image{' '}
          <span className="ml-1 normal-case font-normal text-slate-400">— optional</span>
        </label>
        <label
          onDragEnter={handleImageDragEnter}
          onDragLeave={handleImageDragLeave}
          onDragOver={handleImageDragOver}
          onDrop={handleImageDrop}
          className={`cursor-pointer flex flex-col items-center justify-center rounded-md border-2 border-dashed px-3 py-4 text-sm font-medium transition-colors w-full text-center ${
            isDragging
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span>{draftImage ? 'Replace creative' : 'Upload creative'}</span>
          <span className="mt-0.5 text-[11px] font-normal text-slate-500">or drag & drop here</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleImageFileChange}
            disabled={busy !== null}
          />
        </label>
        {draftImage && (
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setDraftImage(''); setImageError(null); }}
              className="text-xs text-red-500 hover:underline"
            >
              Remove
            </button>
          </div>
        )}
        {draftImage && (
          <img
            src={draftImage}
            alt="Creative preview"
            className="mt-2 max-h-40 w-full object-contain rounded border mb-4"
          />
        )}
        {!draftImage && <div className="mb-4" />}
        {imageError && (
          <div className="text-xs text-red-600 mb-3">{imageError}</div>
        )}

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
