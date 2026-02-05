export type PhotoFile = {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  createdAt: number;   // or string depending on your backend (you currently use i64 millis)
  modifiedAt: number;
  contentHash: string;
};
