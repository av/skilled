import type { SkillCall } from "../models.js";

export interface Provider {
  readonly name: string;
  available(): boolean;
  collect(): SkillCall[];
}
