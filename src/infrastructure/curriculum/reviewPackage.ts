import { curriculumReviewPackageSchema, type CurriculumReviewPackage } from "../../domain/curriculum/review";

let cached: Promise<CurriculumReviewPackage> | null = null;

export function loadCurriculumReviewPackage(): Promise<CurriculumReviewPackage> {
  cached ??= fetch(`${import.meta.env.BASE_URL}curriculum-review.json`, { cache: "no-cache" }).then(async (response) => {
    if (!response.ok) throw new Error(`Не удалось загрузить предложения курса (${response.status})`);
    return curriculumReviewPackageSchema.parse(await response.json());
  });
  return cached;
}
