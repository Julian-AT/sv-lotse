"""AT-Benefits `documents` family: synthetic German letters rendered to PDF with exact gold.

The language model writes structured content (sections, sentences, roles); everything that is an
administrative fact (institutions, dates, case numbers, carriers, deadlines, amounts, medicine
names) comes from a deterministic spec built from a persona and its engine gold, and every gold
position (page, bounding box, text-layer offsets) comes from the renderer, never from a model.
"""
