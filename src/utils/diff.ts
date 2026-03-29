export interface DiffEdit {
  startLine: number;
  endLine: number;
  newText: string;
}

export function extractCodeFromMarkdown(text: string): string | null {
  const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/;
  const match = text.match(codeBlockRegex);
  return match ? match[1].trim() : null;
}

export function computeSimpleDiff(original: string, modified: string): DiffEdit[] {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const edits: DiffEdit[] = [];

  let i = 0;
  let j = 0;

  while (i < origLines.length && j < modLines.length) {
    if (origLines[i] === modLines[j]) {
      i++;
      j++;
    } else {
      const editStart = i;
      // Find next matching line
      let foundMatch = false;
      for (let lookAhead = 1; lookAhead < 20; lookAhead++) {
        for (let origOff = 0; origOff <= lookAhead; origOff++) {
          const modOff = lookAhead - origOff;
          if (
            i + origOff < origLines.length &&
            j + modOff < modLines.length &&
            origLines[i + origOff] === modLines[j + modOff]
          ) {
            edits.push({
              startLine: editStart,
              endLine: i + origOff,
              newText: modLines.slice(j, j + modOff).join('\n'),
            });
            i += origOff;
            j += modOff;
            foundMatch = true;
            break;
          }
        }
        if (foundMatch) break;
      }
      if (!foundMatch) {
        edits.push({
          startLine: editStart,
          endLine: origLines.length,
          newText: modLines.slice(j).join('\n'),
        });
        return edits;
      }
    }
  }

  if (j < modLines.length) {
    edits.push({
      startLine: origLines.length,
      endLine: origLines.length,
      newText: modLines.slice(j).join('\n'),
    });
  } else if (i < origLines.length) {
    edits.push({
      startLine: i,
      endLine: origLines.length,
      newText: '',
    });
  }

  return edits;
}
