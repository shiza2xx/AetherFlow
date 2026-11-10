import { describe, expect, it } from 'vitest';
import { assetValidationCopy } from './asset-validation-copy';

describe('asset validation copy', () => {
  it('explains the composite placement blocker and keeps the backend diagnostic available in both locales', () => {
    const raw = 'Composite has no active instances.';
    expect(assetValidationCopy(raw, 'en')).toMatchObject({
      message: expect.stringMatching(/no saved placements.*Prepare a placement repair.*accepted models.*Review the proposed placements/i),
      technicalDetails: raw,
    });
    expect(assetValidationCopy(raw, 'ru')).toMatchObject({
      message: expect.stringMatching(/не сохранены размещения.*Подготовьте размещения.*принятым моделям.*Проверьте размещения/i),
      technicalDetails: raw,
    });
  });

  it('localizes actionable candidate compatibility warnings and preserves the raw diagnostic', () => {
    const raw = 'Returned geometry differs from its accepted baseline; inspect compatibility before acceptance.';
    expect(assetValidationCopy(raw, 'en')).toMatchObject({
      message: 'Returned geometry differs from its accepted baseline; check compatibility before accepting it.',
      technicalDetails: raw,
    });
    expect(assetValidationCopy(raw, 'ru')).toMatchObject({
      message: 'Возвращённая геометрия отличается от принятой исходной версии. Проверьте совместимость перед принятием.',
      technicalDetails: raw,
    });
  });

  it('localizes item-specific material warnings in Russian', () => {
    expect(assetValidationCopy('Wooden bracket master: returned model materials need visual verification.', 'ru').message)
      .toBe('Проверьте внешний вид материалов в возвращённой модели детали «Wooden bracket master».');
  });
});
