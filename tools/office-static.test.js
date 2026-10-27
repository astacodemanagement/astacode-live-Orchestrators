const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'office', 'index.html'), 'utf8');

assert.match(html, /const MEET_SEATS = \[/, 'meeting seats should include seat metadata');
assert.match(html, /function occupyMeetingSeat/, 'meeting occupants should reserve concrete seats');
assert.match(html, /meeting:'Meeting random'/, 'random meeting should be part of idle activities');
assert.match(html, /buildMeetingChair\(s\)/, 'meeting room should render chairs for every meeting seat');
assert.match(html, /mushFloor=M\(TH\.rugB\[0\]\)/, 'musholla floor should use office palette');
assert.match(html, /const X0=1027, X1=1258, Y0=-36, Y1=212/, 'musholla dimensions should be compact near the parking area');
assert.doesNotMatch(html, /mimbar:\{/, 'musholla should not keep a separate mimbar slot');
assert.doesNotMatch(html, /mimbar bertangga/, 'musholla should not render a mimbar object');
assert.doesNotMatch(html, /#1f6b48|#2e7d4f|#3a9160/, 'musholla green accents should be replaced with blue');
assert.match(html, /g\.fillStyle='#2f6bc4'/, 'musholla accents should use Astacode blue');
assert.match(html, /mih\.position\.set\(wx\(MOSQUE\.imam\.x\),1\.2,mz\)/, 'mihrab should align with imam position');
assert.doesNotMatch(html, /mih\.position\.set\(wx\(1185\)/, 'mihrab should not use stale off-center x coordinate');
assert.match(html, /const WUDHU=\{x0:1258,x1:1420,y0:-36,y1:212\}/, 'wudhu should fill the long side next to musholla');
assert.match(html, /WUDHU\.y0,WUDHU\.x1,WUDHU\.y1,wudhuFloor/, 'wudhu floor should cover the empty side strip');
assert.match(html, /Tempat Wudhu/, 'wudhu area should be labeled');
assert.match(html, /for\(let i=0;i<6;i\+\+\).*tapX/, 'wudhu area should render a row of taps');

console.log('office static checks passed');
