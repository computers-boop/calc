import test from 'node:test';
import assert from 'node:assert/strict';
import {researchArtist, researchReportText} from '../www/research.js';

test('research validates required artist, city and capacity',async()=>{
  await assert.rejects(researchArtist({artist:'',city:'Sofia',capacity:1000}),/artist/i);
  await assert.rejects(researchArtist({artist:'Artist',city:'',capacity:1000}),/artist/i);
});
test('research report includes source URLs and evidence disclaimers',()=>{
  const out=researchReportText({artist:'Act',market:'Sofia',capacity:1000,
    timestamp:'2026-11-26T00:00:00Z',providerStatus:[{label:'MusicBrainz',status:'ok'}],
    sources:[{title:'Local announcement',provider:'News',snippet:'A concert',url:'https://example.com/story'}],
    clues:[],forecast:null,wiki:{profile:null,views:null},mb:null,lastfm:null,events:null});
  assert.match(out,/https:\/\/example.com\/story/);
  assert.match(out,/not verified local ticket sales/i);
});
