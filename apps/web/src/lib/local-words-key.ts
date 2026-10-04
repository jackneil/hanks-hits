/** Compatibility key for the separately reviewed account-deletion call site. */
export function localWordsKey(ownerKey: string): string { return `hh-words:v1:${ownerKey}`; }
export { forgetLocalWords } from "./local-words/runtime";
