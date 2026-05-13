import React, { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { Combobox } from '@/components/ui/Combobox';

const INPUT_DATA_HELP =
  "Стартова точка всього пайплайну. Вводимо URL статті лендингу, 1–3 ключі, цільове GEO та ім'я байєра. ШІ використовує статтю й ключові слова, щоб зрозуміти, хто аудиторія; усе далі — кути, хуки, банери — будується на тому, що ввели тут.";

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
  const { formData, updateFormData, generateAngles, isLoadingAngles } = useAppStore();
  
  // Локальный стейт для отслеживания ошибок
  const [errors, setErrors] = useState({
    articleUrl: false,
    keyword1: false,
    geo: false,
    buyer: false,
  });

  // Функция валидации при нажатии
  const handleGenerate = () => {
    const newErrors = {
      articleUrl: !formData.articleUrl.trim(),
      keyword1: !formData.keyword1.trim(),
      geo: !formData.geo.trim(),
      buyer: !formData.buyer.trim(),
    };

    setErrors(newErrors);

    // Если есть хотя бы одна ошибка - останавливаем отправку
    if (newErrors.articleUrl || newErrors.keyword1 || newErrors.geo || newErrors.buyer) {
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

  const fillTestData = () => {
    handleChange('articleUrl', import.meta.env.PUBLIC_TEST_ARTICLE_URL);
    handleChange('keyword1', import.meta.env.PUBLIC_TEST_KEYWORD1);
    handleChange('geo', import.meta.env.PUBLIC_TEST_GEO || 'United States (US)');
    handleChange('buyer', import.meta.env.PUBLIC_TEST_BUYER);
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
            onChange={(v) => handleChange('geo', v)}
            options={COUNTRIES}
            placeholder="Click to choose or type… e.g. United States, Ukraine, DE"
            error={errors.geo}
          />
          {errors.geo && <p className="text-[10px] text-red-500 mt-1">Required field</p>}
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