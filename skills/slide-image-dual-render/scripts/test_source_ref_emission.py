"""Join explicit source references to a bounded ordered OOXML sequence.

PR1's extractor/verifier is unchanged. The ordinal is explicit in this fixture;
geometry is a verification constraint, never an object-matching heuristic.
"""
import argparse, hashlib, json, sys, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from test_render_provenance import verify as verify_pr1, NS

def assert_supported_shape_tree(pptx):
    # Test-local scope guard, not a general OOXML/openability validator. PR1's
    # unchanged extractor only counts direct p:sp/p:pic; reject everything it
    # would silently skip except the two required spTree structural records.
    with zipfile.ZipFile(pptx) as package:
        root = ET.fromstring(package.read('ppt/slides/slide1.xml'))
    tree = root.find('p:cSld/p:spTree', NS)
    assert tree is not None, 'missing slide1 shape tree'
    permitted = {f"{{{NS['p']}}}{name}" for name in ('nvGrpSpPr', 'grpSpPr', 'sp', 'pic')}
    for child in tree:
        assert child.tag in permitted, f'unsupported top-level shape-tree child: {child.tag}'

def verify(pptx, manifest, canonical_texts=None):
    assert_supported_shape_tree(pptx)
    return verify_pr1(pptx, manifest, canonical_texts)

def sha(raw):return hashlib.sha256(raw).hexdigest()
def canonical(obj):return json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def run_verification(directory):
 d=Path(directory).resolve()
 load=lambda name:json.loads((d/name).read_text())
 job=load('job.json');inventory=load('inventory.json');review=load('review.json')
 assert job['content_hash']==sha(canonical({k:v for k,v in job.items() if k!='content_hash'}))
 assert job['source_png_sha256']==sha((d/'source.png').read_bytes())==review['source_png_sha256']
 assert job['inventory_sha256']==sha((d/'inventory.json').read_bytes())==review['measurement_inventory_sha256']
 assert job['review_sha256']==sha((d/'review.json').read_bytes())
 authority={k:False for k in ('semantic_truth','text_removal','native_admission','vector_eligibility','quality_accepted')}
 expected_bindings={'jobContentHash':job['content_hash'],'sourcePngSha256':job['source_png_sha256'],
  'measurementInventorySha256':job['inventory_sha256'],'reviewArtifactSha256':job['review_sha256']}
 expected_sources=job['explicitObjectSequence'];assert len(expected_sources)==len(inventory['observations'])==3
 expected_errors={'drop-text':'object count mismatch','same-length-text':'text identity mismatch',
  'drop-shape':'object count mismatch','changed-image-after-call':'image identity mismatch',
  'extra-object':'object count mismatch','reordered-objects':'geometry mismatch'}
 rows=[];control=None
 for entry in load('emission-results.json')['results']:
  mode=entry['case'];manifest=load(f'{mode}.manifest.json');objects=manifest['slides']['1']['objects']
  assert len(objects)==3
  if control is None:control=objects
  else:assert control==objects
  assert sha((d/f'{mode}.pptx').read_bytes())==entry['package_sha256']
  assert sha((d/f'{mode}.manifest.json').read_bytes())==entry['manifest_sha256']
  sources=[]
  for index,obj in enumerate(objects):
   tag=obj['sourceRefs'];claim=tag['claim'];observation=inventory['observations'][index]
   assert tag['schemaVersion']=='slide-image-dual-render.source-refs.v1' and tag['slide']==1
   assert tag['bindings']==expected_bindings and tag['authority']==authority
   assert all(value is False for value in tag['authority'].values())
   assert claim['kind']=='observation' and claim['disposition']=='linked' and claim['glyphMembers']==[]
   assert claim['source']==expected_sources[index]==observation['source']
   assert {k:obj[k] for k in ('x','y','w','h')}==observation['bbox_px']
   sources.append((claim['source']['collection'],claim['source']['observation_id']))
  assert len(set(sources))==3
  try:
   extracted=verify(d/f'{mode}.pptx',manifest,{'0':inventory['observations'][0]['text']})
  except AssertionError as error:
   assert mode!='positive',str(error)
   assert expected_errors[mode] in str(error),(mode,str(error))
   rows.append({'case':mode,'source_claims_and_rows_unchanged':True,'package_correspondence':'REJECTED','reason':str(error)})
  else:
   assert mode=='positive',f'Unexpected package acceptance: {mode}'
   assert [r['kind'] for r in extracted]==['text','shape','image']
   assert extracted[2]['sha256']==inventory['observations'][2]['image_sha256']==sha((d/'asset-original.png').read_bytes())
   rows.append({'case':mode,'package_correspondence':'VERIFIED_FOR_DECLARED_SEQUENCE',
    'joins':[{'source':source,'manifest_pointer':f'/slides/1/objects/{i}',
       'manifest_row_sha256':sha(canonical(objects[i])),'package_object_ordinal':i,
       'package_kind':obj['kind'],'geometry_emu':obj['geometryEmu'],
       **({'content_sha256':obj['sha256']} if 'sha256' in obj else {})}
       for i,(source,obj) in enumerate(zip(expected_sources,extracted))]})
 # Each synthetic extra is ignored by the unmodified PR1 extractor, but the
 # narrow wrapper rejects it before any object-count claim is made.
 unsupported=[]
 for name in ('grpSp', 'graphicFrame', 'cxnSp', 'contentPart', 'AlternateContent'):
  positive=d/'positive.pptx'; target=d/f'unsupported-{name}.pptx'
  namespace='http://schemas.openxmlformats.org/markup-compatibility/2006' if name=='AlternateContent' else NS['p']
  with zipfile.ZipFile(positive) as original, zipfile.ZipFile(target,'w') as changed:
   for info in original.infolist():
    raw=original.read(info.filename)
    if info.filename=='ppt/slides/slide1.xml':
     root=ET.fromstring(raw);tree=root.find('p:cSld/p:spTree',NS)
     ET.SubElement(tree,f'{{{namespace}}}{name}')
     raw=ET.tostring(root,encoding='utf-8',xml_declaration=True)
    changed.writestr(info,raw)
  manifest=load('positive.manifest.json')
  assert len(verify_pr1(target,manifest))==3
  try:verify(target,manifest)
  except AssertionError as error:
   assert 'unsupported top-level shape-tree child:' in str(error)
   unsupported.append({'type':name,'unchanged_PR1_ignores_extra':True,'guard':'REJECTED','reason':str(error),'sha256':sha(target.read_bytes())})
  else:raise AssertionError(f'Unsupported element accepted: {name}')
 report={'status':'PASS','scope':'mechanical package correspondence for one invented ordered primitive sequence',
  'cases':rows,'unsupported_top_level_cases':unsupported,'native_text_objects':1,'native_shape_objects':1,'raster_image_objects':1,
  'all_surface_rows_equal':True,'matching':'Explicit complete ordered sequence; extras/count/reorder rejected; no bbox search',
  'authority':authority,'semantic_classification_verified':False,'visual_fidelity_verified':False,
  'actual_PR18_fixture_used':False,'production_gate_added':False,'durable_object_ids_added':False,
  'limitations':['Only direct p:sp/p:pic drawables in slide1 are supported; other shape-tree children are rejected',
  'Not a general OOXML verifier: unsupported negative containers are synthetic XML sentinels, not valid table/chart/group packages',
  'Row position is bounded test correspondence, not a durable object identifier',
  'Shape kind and EMU geometry verified; no full style/font/visual equivalence check',
  'Raster media remains raster content, not native editable pixels',
  'Source review and classification are invented unauthenticated claims']}
 (d/'verification-result.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
 return report

if __name__ == '__main__':
 parser=argparse.ArgumentParser()
 parser.add_argument('directory',type=Path)
 run_verification(parser.parse_args().directory)
