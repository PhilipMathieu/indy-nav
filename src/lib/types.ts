export interface MountainSeed {
  id: string;
  name: string;
  state: string;
  region: string;
  lat: number | null;
  lon: number | null;
  isNordic: boolean;
  isAlpineXc: boolean;
  isXcOnly: boolean;
  isAllied: boolean;
  websiteUrl: string;
  closingDateUrl: string;
}

export interface Mountain {
  id: string;
  name: string;
  region: string;
  state: string;
  closingDate: string | null;
  closingDateSource: string;
  closingDateConfidence: "high" | "medium" | "low";
  lastUpdated: string;
  websiteUrl: string;
}
