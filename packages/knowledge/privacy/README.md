# Screen capture privacy policy

`screen-capture-exclusions.json` contains the sourced default bundle identifiers excluded
from native turn captures. The app also excludes its own bundle and process. These are
application exclusions, with no window exceptions. They protect supported native password
managers and banking applications; they cannot recognize banking tabs or password-manager
extensions inside another application's windows.

After changing this data, run `bash apps/mac/Scripts/generate-capture-policy.sh` from the
repository root. It generates the byte-identical resource SwiftPM bundles in LotseCapture.
Missing or malformed resources stop capture. Per-device UserDefaults additions extend,
and cannot replace, these defaults.
