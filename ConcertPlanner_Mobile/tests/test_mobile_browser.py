"""Browser smoke tests and real 390px mobile screenshots; for development QA."""
import json, time, subprocess, pathlib, socket, mimetypes, urllib.parse
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
port = 8765
server=subprocess.Popen(['python3','-m','http.server',str(port),'-d',str(ROOT/'www')],
                        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(.8)
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block',accept_downloads=True)
        errors=[]
        page.on('pageerror', lambda error: errors.append(str(error)))
        # Browser policy blocks all navigations in this CI environment (even
        # localhost/file URLs). Inline the exact app sources for UI QA.
        import re, base64
        html=(ROOT/'www'/'index.html').read_text()
        style=(ROOT/'www'/'styles.css').read_text()
        scripts=[]
        for filename in ('finance.js','research.js','app.js'):
            source=(ROOT/'www'/filename).read_text()
            source=re.sub(r'^import .*?;\s*$', '', source, flags=re.M|re.S) if filename=='app.js' else source
            source=re.sub(r'\bexport\s+', '', source)
            scripts.append(source)
        embedded='\n'.join(scripts)
        html=re.sub(r'<link rel="stylesheet" href="styles.css">', '<style>'+style+'</style>', html)
        html=re.sub(r'<link[^>]+(?:rel="manifest"|rel="apple-touch-icon"|rel="icon")[^>]*>', '', html)
        icon=base64.b64encode((ROOT/'www'/'icons'/'stage-192.png').read_bytes()).decode()
        html=html.replace('icons/stage-192.png','data:image/png;base64,'+icon)
        html=html.replace('<script type="module" src="app.js"></script>', '<script>'+embedded+'</script>')
        html=re.sub(r"<script>\s*if \('serviceWorker'.*?</script>", '', html, flags=re.S)
        page.evaluate("""Object.defineProperty(window,'localStorage',{configurable:true,value:(()=>{const d=new Map();return {setItem:(k,v)=>d.set(k,String(v)),getItem:k=>d.has(k)?d.get(k):null,removeItem:k=>d.delete(k),clear:()=>d.clear()}})()})""")
        page.set_content(html,wait_until='load')
        page.locator('.hero h1').wait_for()
        page.screenshot(path='/mnt/data/ConcertPlanner_Mobile_Plan_Preview.png',full_page=True)
        assert page.locator('.nav-btn').count()==5
        assert page.locator('input[data-field="artist"]').count()==1
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'horizontal overflow on plan'
        # Event inputs + supporting artist
        page.locator('[data-field="artist"]').fill('Example Headliner')
        page.locator('[data-field="city"]').fill('Sofia')
        page.locator('[data-field="capacity"]').fill('2500')
        page.locator('[data-field="base_attendance_pct"]').fill('65')
        page.locator('[data-action="add-artist"]').click()
        page.locator('[data-support-name="0"]').fill('Opening Act')
        page.locator('[data-support-fee="0"]').fill('750')
        assert page.locator('#support-total').inner_text().strip().startswith('€750')
        # budget
        page.locator('.nav-btn[data-tab="budget"]').click()
        page.locator('[data-budget="artist_fee"]').fill('25000')
        page.locator('[data-budget="venue"]').fill('6500')
        page.locator('[data-budget="sponsor_money"]').fill('3000')
        page.locator('[data-field="target_profit"]').fill('8000')
        page.locator('[data-field="bar_revenue_per_attendee"]').fill('6')
        assert page.locator('[data-budget]').count()==17
        page.screenshot(path='/mnt/data/ConcertPlanner_Mobile_Budget_Preview.png',full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'horizontal overflow on budget'
        page.locator('[data-action="calculate"]').click()
        page.get_by_text('Financial results').wait_for()
        assert 'Opening Act' not in page.locator('.page-heading').inner_text()
        assert page.get_by_text('Support fees').count()>0
        page.screenshot(path='/mnt/data/ConcertPlanner_Mobile_Results_Preview.png',full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'horizontal overflow on results'
        # save and compare
        page.locator('#header-save').click()
        page.locator('.nav-btn[data-tab="library"]').click()
        page.get_by_text('Example Headliner').first.wait_for()
        assert page.locator('[data-select-saved]').count()==1
        page.locator('.nav-btn[data-tab="budget"]').click()
        page.locator('[data-budget="venue"]').fill('8000')
        page.locator('#header-save').click()
        page.locator('.nav-btn[data-tab="library"]').click()
        assert page.locator('[data-select-saved]').count()==2
        page.locator('[data-select-saved]').first.check()
        page.locator('[data-select-saved]').last.check()
        page.locator('[data-action="compare-library"]').click()
        assert page.locator('dialog[open]').count()==1
        assert page.get_by_text('Compare concert plans').count()==1
        page.locator('[data-action="close-dialog"]').click()
        # export desktop-compatible JSON (download event; no share support in automation)
        with page.expect_download() as down:
            page.locator('[data-action="export-saved"]').first.click()
        download=down.value
        saved_bytes=pathlib.Path(download.path()).read_text()
        exported=json.loads(saved_bytes)
        assert 'support_artists' in exported and len(exported['support_artists'])==1
        assert 'budget' in exported and 'venue' in exported['budget']
        # import original style desktop JSON
        page.locator('[data-action="library-tab"][data-kind="files"]').click()
        test_json={'timestamp':'2026-11-26T00:00:00','artist':'Legacy Artist','city':'Plovdiv',
                   'capacity':1600,'base_attendance_pct':70,
                   'budget':{'artist_fee':4000, 'ticket_fee_pct':6,'tax_pct':3}}
        page.set_input_files('#file-input',{'name':'legacy_concert.json','mimeType':'application/json','buffer':json.dumps(test_json).encode()})
        page.get_by_text('legacy_concert.json').wait_for()
        assert page.locator('[data-action="load-file"]').count()==1
        page.locator('[data-action="load-file"]').click()
        assert page.locator('[data-field="artist"]').input_value()=='Legacy Artist'
        # Research failure gracefully after network blocked
        page.route('https://**',lambda route:route.fulfill(status=503,body='blocked'))
        page.locator('.nav-btn[data-tab="research"]').click()
        page.locator('[data-action="run-research"]').click()
        page.locator('[data-action="export-research"]').wait_for(timeout=12000)
        assert page.get_by_text('Provider coverage').count()>0
        assert page.locator('.nav-btn').count()==5
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        # narrow phone test
        page.set_viewport_size({'width':320,'height':740})
        page.locator('.nav-btn[data-tab="plan"]').click()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'horizontal overflow on 320px'
        # tablet test
        page.set_viewport_size({'width':768,'height':1024})
        page.locator('.nav-btn[data-tab="budget"]').click()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'horizontal overflow on tablet'
        assert not errors, errors
        print('PASS: 5 tabs, phone/tablet layout, support artists, 17 fields, calculation, save/load, compare, JSON import/export, provider-failure research, no JS errors.')
        browser.close()
finally:
    server.terminate(); server.wait(timeout=5)
