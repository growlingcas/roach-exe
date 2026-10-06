import json, os
HERE=os.path.dirname(os.path.abspath(__file__))
SRC=os.path.join(HERE,'src')+os.sep
A=os.path.join(HERE,'assets')+os.sep
imgs=json.load(open(A+'imgs_hq.json'))
body=''.join(open(SRC+f).read() for f in ['part1.html','part2.html','part2b.html','part3.html','part4.html'])
body='<style>:root{'+''.join('--img-%s:url(%s);'%(k,v) for k,v in imgs.items())+''.join('--card-%s:url(%s);'%(k,v) for k,v in json.load(open(A+'cards.json')).items())+'}</style>\n'+body.replace('<title>PRAY</title>\n','',1)
body='<title>PRAY</title>\n'+body
body=body.replace('{{ICONS_JSON}}',open(A+'icons.json').read())
assert '{{' not in body
OUT=os.path.join(HERE,'..','public','index.html')
open(OUT,'w').write('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="icon" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAEjElEQVR4nOyYaVBbVRTHb5AxwbIFKzCCFWpCCImtUIjUrSq1gqZKWhYLwpRlEKq1Tse6tOIwEXQQGVtra6tAtThOBxpiW4uBskptujiOLQlYLYS1BRMWh1CywKSnTSeE917yQpIPfMhv8iHv3HvO/HPuPee+G3cqlYqWEu5oieESRIZLEBkuQWS4BJHhhpxBOIsZxmQgZ0BxytEh+UU0o9EIktKRwzghQ+lbUrjciJjoqOTNichh7nF3t38bcTjsNVGPlQgLjWnm8aKv9fTSaDSlUoXsZXFLxgpjro2NiY3lcTnskIdX3DYZIIb5lLvPir5+mbxbKr1wTnoRVCKbsUlQBJuV+Cr/FX5CcHAQWjx9/QMnT9XXin5WKPpJJ5MIYoUxioUfQ1aQM2hqbisSfgb6kB2CPD09C3fvSk9LQYsFu4hYKquOflpartXqkO2CHudFH/jqi8DAAGQZtVqt0+v96HSMfXRUuWyZB/weK769vX0F23fK5d34IYKy35qZJqqptqQGdByrEWVmvRHOjdFqtPgJSpUKhrJyt9UcF9+8OUMYZOXKkIbTdRv5CfghbIZSkzeVl5UQRvn3Wk9F5dFakVin0xstg4ouCgW7PKP/KdfwnjF+96DRUpIFudmZoaEh+IBzc3N5BTsaGpstChIk8vfvLcN7Dg9f310obG5pX+BJoYAg/OTx8YlVUU9gjC/FvyAs2kOY9S2vZ3eclZoe55eMyXikrLQY73ClUx7P34xRAxgMBp2OYGNOqdV4Y73kDATp7r6KHzp0cG9Q0INYQVTqvVUVB2i4DQ6FKkhKm5iYREQMDV3HGwcGBgknq1RjGwWvtbWfxdh9vL2/rzhoOjDmM6TX69EiuXylE2/867LMisvs7Cyh3c2NskAQdIXs3DdnZrBFsT7uWfHxn+h0X8Iov0rO4I0tre2Ek5cvv/+U+BgExNinp6e35m4zFcp8hqCBbt/xHj7Qqkc58Hbx3LqnCQQ1NA0ODZtb4Ai79Mef+JngDkHYbBZ+qOCtnVA0pscFfUjS2JSWkQNvNhgf2HTVP3xbV/sjiDO3w76GTWZuaW3rwPhGRq4GR3DHlxgsSFJqRkvrb+ZGgk4dFbn6u8P7A/wfQERIz1+Eiuv4XWrssy8nbDj8zT7TaF7+2/V31hGkP/Xk2rjn10HTJ4wzMjIKKyWTYRsH8dHh4+Nd/nlJ/IvrkWWg9KAjQDrjN8SZjJLG5vs8PECNr6+PFd8TJ09/sKdoaoqgQVg77aFPfvThroAAf2QrZOcqNPeh4U+KS+uJqoFcELrTn/LzcvLzsry8vJBjcsbGxvd9fajqSDWyik0vaHAkpaZsysnKCA0NQVaUWFD099V/Ko9Ui+pOmGrbUUEm2OFh8P4K72tcTsSKh4KtzFQo+jplXdLzl85JL/T0KpDN2H8NotGoTAYjMNDfz4/+/rvvQHZKy76EdblxY6SL6MyyEfuvHBqNtlMmhw9857DDoSfV1IqRwzjnKg1XC8PtHeQEnHNzNXadycn/kcM4R5ATcf0dQ4ZLEBkuQWS4BJGx5ATdAgAA//+siHmTAAAABklEQVQDAHoZqWpztTyPAAAAAElFTkSuQmCC">\n</head>\n<body>\n'+body+'\n</body>\n</html>\n')

print('built public/index.html')
