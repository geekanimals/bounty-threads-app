-- Short links already sent (/s/<slug>) now open the new site; old /app.html?... routes work there (/legacy router).
update intel.msg_link
   set url = replace(replace(url, 'https://www.bountythreads.geekcreativeagency.com', 'https://bounty.geekcreativeagency.com'),
                     'www.bountythreads.geekcreativeagency.com', 'bounty.geekcreativeagency.com')
 where url ilike '%bountythreads.geekcreativeagency.com%';
