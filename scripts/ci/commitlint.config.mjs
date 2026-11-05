import policy from "../../commitlint.config.mjs";

// CI checks every selected message, including commitlint's default ignored forms.
export default { ...policy, defaultIgnores: false };
