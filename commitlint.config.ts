import { RuleConfigSeverity, type UserConfig } from "@commitlint/types";
import { BODY_LINE_MAX, COMMIT_SCOPES, COMMIT_TYPES, SUBJECT_MAX } from "./tools/commit-rules.ts";

const ERROR = RuleConfigSeverity.Error;

const config: UserConfig = {
  rules: {
    "type-enum": [ERROR, "always", [...COMMIT_TYPES]],
    "type-case": [ERROR, "always", "lower-case"],
    "type-empty": [ERROR, "never"],
    "scope-enum": [ERROR, "always", [...COMMIT_SCOPES]],
    "scope-case": [ERROR, "always", "lower-case"],
    "subject-empty": [ERROR, "never"],
    "subject-case": [ERROR, "never", ["sentence-case", "start-case", "pascal-case", "upper-case"]],
    "subject-full-stop": [ERROR, "never", "."],
    "subject-max-length": [ERROR, "always", SUBJECT_MAX],
    "body-leading-blank": [ERROR, "always"],
    "footer-leading-blank": [ERROR, "always"],
    "body-max-line-length": [ERROR, "always", BODY_LINE_MAX],
    "footer-max-line-length": [ERROR, "always", BODY_LINE_MAX],
  },
};

export default config;
