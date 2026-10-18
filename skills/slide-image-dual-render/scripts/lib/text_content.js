// Shared emitted-text preparation; authored content and provenance stay untouched.
// LF is a logical break and CRLF is one LF, even across adjacent rich runs.
// Standalone CR and the backends' established final breakLine behavior remain
// unchanged. This is not whitespace normalization or a typography measurement.
function prepareTextRuns(content){
  const runs = Array.isArray(content)
    ? content.map(run => ({...run}))
    : [{text:String(content)}];
  let previousText = -1;
  for(let i=0; i<runs.length; i++){
    const run = runs[i];
    if(typeof run.text === 'string'){
      if(previousText >= 0 && run.text.startsWith('\n') && runs[previousText].text.endsWith('\r')){
        runs[previousText].text = runs[previousText].text.slice(0,-1);
      }
      if(run.text.length) previousText = i;
    } else {
      previousText = -1;
    }
    if(run.breakLine) previousText = -1;
  }
  return runs.flatMap(run => {
    if(typeof run.text !== 'string') return [{...run, breakLine:!!run.breakLine}];
    const parts = run.text.replace(/\r\n/g,'\n').split('\n');
    return parts.map((text,index) => ({...run, text, breakLine:index < parts.length-1 || !!run.breakLine}));
  });
}
module.exports = {prepareTextRuns};
