import React, { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export const Column1 = () => {
  const { formData, updateFormData, generateAngles, isLoadingAngles } = useAppStore();
  
  // Локальный стейт для отслеживания ошибок
  const [errors, setErrors] = useState({
    articleUrl: false,
    keyword1: false,
    buyer: false,
  });

  // Функция валидации при нажатии
  const handleGenerate = () => {
    const newErrors = {
      articleUrl: !formData.articleUrl.trim(),
      keyword1: !formData.keyword1.trim(),
      buyer: !formData.buyer.trim(),
    };
    
    setErrors(newErrors);

    // Если есть хотя бы одна ошибка - останавливаем отправку
    if (newErrors.articleUrl || newErrors.keyword1 || newErrors.buyer) {
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

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-xl mb-2">1. Input Data</h2>
      
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
          <label className="text-xs font-medium uppercase text-slate-500">GEO</label>
          <Input 
            value={formData.geo} 
            onChange={(e) => handleChange('geo', e.target.value)} 
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