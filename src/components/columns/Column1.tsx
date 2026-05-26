import React, { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { Combobox } from '@/components/ui/Combobox';
import { adLanguagesForGeo } from '@/lib/geos';

const INPUT_DATA_HELP =
  "Стартова точка всього пайплайну. Вводимо URL статті лендингу, 1–3 ключі, цільове GEO та ім'я байєра. ШІ використовує статтю й ключові слова, щоб зрозуміти, хто аудиторія; усе далі — кути, хуки, банери — будується на тому, що ввели тут.";

const AD_LANGUAGE_HELP =
  "Мова, якою ШІ напише фінальні рекламні тексти. Застосовується вже на кроці «3. Concepts» — хуки, акценти, CTA й Meta-копія повертаються одразу цією мовою, а не англійською. Той самий вибір використовується і для банерів у «4. Creatives batches». Список мов залежить від обраного GEO — показуються лише релевантні для країни.";

const COUNTRIES: string[] = [
  'United States (US)',
  'United Kingdom (UK)',
  'Canada (CA)',
  'Australia (AU)',
  'New Zealand (NZ)',
  'Ireland (IE)',
  'Germany (DE)',
  'Austria (AT)',
  'Switzerland (CH)',
  'France (FR)',
  'Belgium (BE)',
  'Netherlands (NL)',
  'Luxembourg (LU)',
  'Spain (ES)',
  'Portugal (PT)',
  'Italy (IT)',
  'Greece (GR)',
  'Cyprus (CY)',
  'Malta (MT)',
  'Poland (PL)',
  'Czech Republic (CZ)',
  'Slovakia (SK)',
  'Hungary (HU)',
  'Romania (RO)',
  'Bulgaria (BG)',
  'Slovenia (SI)',
  'Croatia (HR)',
  'Serbia (RS)',
  'Bosnia and Herzegovina (BA)',
  'North Macedonia (MK)',
  'Albania (AL)',
  'Kosovo (XK)',
  'Montenegro (ME)',
  'Estonia (EE)',
  'Latvia (LV)',
  'Lithuania (LT)',
  'Sweden (SE)',
  'Denmark (DK)',
  'Norway (NO)',
  'Finland (FI)',
  'Iceland (IS)',
  'Ukraine (UA)',
  'Belarus (BY)',
  'Russia (RU)',
  'Moldova (MD)',
  'Georgia (GE)',
  'Turkey (TR)',
  'Israel (IL)',
  'United Arab Emirates (AE)',
  'Saudi Arabia (SA)',
  'Qatar (QA)',
  'Kuwait (KW)',
  'Egypt (EG)',
  'Morocco (MA)',
  'South Africa (ZA)',
  'Nigeria (NG)',
  'Kenya (KE)',
  'India (IN)',
  'Pakistan (PK)',
  'Bangladesh (BD)',
  'Sri Lanka (LK)',
  'Indonesia (ID)',
  'Malaysia (MY)',
  'Singapore (SG)',
  'Thailand (TH)',
  'Vietnam (VN)',
  'Philippines (PH)',
  'Japan (JP)',
  'South Korea (KR)',
  'Taiwan (TW)',
  'Hong Kong (HK)',
  'China (CN)',
  'Mexico (MX)',
  'Brazil (BR)',
  'Argentina (AR)',
  'Chile (CL)',
  'Colombia (CO)',
  'Peru (PE)',
  'Uruguay (UY)',
  'Costa Rica (CR)',
  'Panama (PA)',
];

export const Column1 = () => {
  const { formData, updateFormData, generateAngles, isLoadingAngles, adLanguage, setAdLanguage } = useAppStore();
  
  // Локальный стейт для отслеживания ошибок
  const [errors, setErrors] = useState({
    articleUrl: false,
    keyword1: false,
    geo: false,
    buyer: false,
    campaignName: false,
  });

  // Функция валидации при нажатии
  const handleGenerate = () => {
    const newErrors = {
      articleUrl: !formData.articleUrl.trim(),
      keyword1: !formData.keyword1.trim(),
      geo: !formData.geo.trim(),
      buyer: !formData.buyer.trim(),
      campaignName: !formData.campaignName.trim(),
    };

    setErrors(newErrors);

    // Если есть хотя бы одна ошибка - останавливаем отправку
    if (newErrors.articleUrl || newErrors.keyword1 || newErrors.geo || newErrors.buyer || newErrors.campaignName) {
      return;
    }

    // Если всё ок - запускаем запрос в n8n
    generateAngles();
  };

  // Обертка над updateFormData, чтобы убирать красную обводку, когда юзер начал вводить текст
  const handleChange = (field: keyof typeof formData, value: string) => {
    updateFormData(field, value);
    if (errors[field as keyof typeof errors]) {
      setErrors((prev) => ({ ...prev, [field]: false }));
    }
  };

  // Ad languages are restricted to the picked GEO (same system as Keywords/Angles).
  const adLangOptions = adLanguagesForGeo(formData.geo);

  // When GEO changes, keep the Ad language valid for the new country.
  const handleGeoChange = (value: string) => {
    handleChange('geo', value);
    const allowed = adLanguagesForGeo(value);
    if (!allowed.includes(adLanguage)) setAdLanguage(allowed[0]);
  };

  const fillTestData = () => {
    handleChange('articleUrl', import.meta.env.PUBLIC_TEST_ARTICLE_URL);
    handleChange('keyword1', import.meta.env.PUBLIC_TEST_KEYWORD1);
    handleChange('geo', import.meta.env.PUBLIC_TEST_GEO || 'United States (US)');
    handleChange('buyer', import.meta.env.PUBLIC_TEST_BUYER);
    handleChange('campaignName', import.meta.env.PUBLIC_TEST_CAMPAIGN_NAME || 'CN_MVP_TEST');
    setAdLanguage(import.meta.env.PUBLIC_TEST_AD_LANGUAGE || 'English (US)');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="flex items-center gap-1.5 font-bold text-xl">
          1. Input Data
          <InfoTooltip text={INPUT_DATA_HELP} />
        </h2>
        <Button variant="ghost" size="sm" onClick={fillTestData}>Test data</Button>
      </div>
      
      <div className="space-y-3">
        {/* Article URL (Required) */}
        <div>
          <label className="text-xs font-medium uppercase text-slate-500">Article URL *</label>
          <Input 
            value={formData.articleUrl} 
            onChange={(e) => handleChange('articleUrl', e.target.value)} 
            placeholder="https://..." 
            className={errors.articleUrl ? "border-red-500 focus-visible:ring-red-500" : ""}
          />
          {errors.articleUrl && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
        </div>

        {/* Keyword 1 (Required) */}
        <div>
          <label className="text-xs font-medium uppercase text-slate-500">Keyword 1 *</label>
          <Input 
            value={formData.keyword1} 
            onChange={(e) => handleChange('keyword1', e.target.value)} 
            className={errors.keyword1 ? "border-red-500 focus-visible:ring-red-500" : ""}
          />
          {errors.keyword1 && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
        </div>

        {/* Keyword 2 */}
        <div>
          <label className="text-xs font-medium uppercase text-slate-500">Keyword 2</label>
          <Input 
            value={formData.keyword2} 
            onChange={(e) => handleChange('keyword2', e.target.value)} 
          />
        </div>

        {/* Keyword 3 */}
        <div>
          <label className="text-xs font-medium uppercase text-slate-500">Keyword 3</label>
          <Input 
            value={formData.keyword3} 
            onChange={(e) => handleChange('keyword3', e.target.value)} 
          />
        </div>

        {/* GEO */}
        <div>
          <label className="text-xs font-medium uppercase text-slate-500">GEO *</label>
          <Combobox
            value={formData.geo}
            onChange={handleGeoChange}
            options={COUNTRIES}
            placeholder="Click to choose or type… e.g. United States, Ukraine, DE"
            error={errors.geo}
          />
          {errors.geo && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
        </div>

        {/* Ad language — moved here from Concepts; now drives step 3 (Concepts) AND step 4 (Creatives). */}
        <div>
          <label className="flex items-center gap-1 text-xs font-medium uppercase text-slate-500">
            Ad language
            <InfoTooltip text={AD_LANGUAGE_HELP} />
          </label>
          <Combobox
            value={adLanguage}
            onChange={setAdLanguage}
            options={adLangOptions}
            placeholder="Click to choose or type… e.g. English (US), Polish, German"
          />
        </div>

        {/* Buyer (Required) */}
        <div>
          <label className="text-xs font-medium uppercase text-slate-500">Buyer *</label>
          <Input
            value={formData.buyer}
            onChange={(e) => handleChange('buyer', e.target.value)}
            className={errors.buyer ? "border-red-500 focus-visible:ring-red-500" : ""}
          />
          {errors.buyer && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
        </div>

        {/* Campaign Name (Required) */}
        <div>
          <label className="text-xs font-medium uppercase text-slate-500">Campaign Name *</label>
          <Input
            value={formData.campaignName}
            onChange={(e) => handleChange('campaignName', e.target.value)}
            className={errors.campaignName ? "border-red-500 focus-visible:ring-red-500" : ""}
          />
          {errors.campaignName && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
        </div>
      </div>

      {/* Кнопка теперь всегда активна для клика, блокируется только во время загрузки */}
      <Button 
        onClick={handleGenerate} 
        disabled={isLoadingAngles}
        className="mt-4"
      >
        {isLoadingAngles ? "Generating..." : "Generate"}
      </Button>
    </div>
  );
};