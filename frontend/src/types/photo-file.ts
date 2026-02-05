export type PhotoFile = {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  createdAt: number;   // or string depending on your backend (you currently use i64 millis)
  modifiedAt: number;
  contentHash: string;    // always set ("" only if hashing fails)
  perceptualHash?: string; // for decodable types; "" or undefined if not set
};
