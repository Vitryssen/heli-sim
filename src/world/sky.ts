/** Time of day and weather. Purely visual: the flight model never sees it. */
export const SKIES = ['noon', 'golden', 'overcast'] as const;
export type SkyId = typeof SKIES[number];
export const SKY_LABEL: Record<SkyId, string> = { noon: 'Clear noon', golden: 'Golden hour', overcast: 'Overcast and hazy' };
export const skyId = (v: unknown): SkyId => (SKIES.includes(v as SkyId) ? (v as SkyId) : 'noon');
