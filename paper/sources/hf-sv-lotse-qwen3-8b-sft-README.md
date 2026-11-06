---
license: apache-2.0
base_model: Qwen/Qwen3-8B
library_name: peft
datasets: [JulianAT/at-benefits]
tags: [sft, lora, tool-calling, qwen3]
---
# SV-Lotse-Qwen3-8B-SFT (LoRA adapter)

LoRA adapter (r=64, alpha=128) for Qwen/Qwen3-8B, SFT on JulianAT/at-benefits dialogues + situations.
Use the Qwen3 chat template with `tools=` and `enable_thinking=False`; truncate tool outputs to 250 characters.
Final eval loss: 0.03589601069688797. **Evaluation results and the full model card are being added.**
Not medical, legal or financial advice; medical questions go to the treating doctor or 1450.
