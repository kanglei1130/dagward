// @ts-expect-error lodash is deliberately not installed
import _ from "lodash";
import { util } from "@lib/util";

export function app(): string {
  return util() + String(_);
}
