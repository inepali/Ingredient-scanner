-- Scans keep the allergens printed on the label.
alter table scans add column allergens text[] not null default '{}';

-- Starting reference scores. These are a rubric to tune with real scans, not
-- medical advice. Band is derived from score (80+ great, 60+ good, 40+ fair,
-- 20+ poor, else avoid). Unknown ingredients fall back to the model's
-- provisional score and are flagged `provisional` on the scan.
insert into ingredient_reference (canonical_name, aliases, score, band, notes)
select
  v.n,
  v.a,
  v.s,
  case
    when v.s >= 80 then 'great'
    when v.s >= 60 then 'good'
    when v.s >= 40 then 'fair'
    when v.s >= 20 then 'poor'
    else 'avoid'
  end,
  v.note
from (values
  -- whole and minimally processed foods
  ('water',                 array['filtered water','purified water','carbonated water','spring water']::text[], 95, 'Neutral base'),
  ('oats',                  array['rolled oats','whole grain oats','whole oats','steel cut oats','oat flour']::text[], 85, 'Whole grain'),
  ('whole wheat flour',     array['whole grain wheat flour','whole wheat','whole grain wheat']::text[], 82, 'Whole grain'),
  ('brown rice',            array['whole grain brown rice']::text[], 82, 'Whole grain'),
  ('quinoa',                array[]::text[], 90, 'Whole grain/seed'),
  ('lentils',               array['lentil','red lentils','green lentils']::text[], 90, 'Legume'),
  ('chickpeas',             array['garbanzo beans','chickpea']::text[], 90, 'Legume'),
  ('black beans',           array['beans','kidney beans','pinto beans']::text[], 88, 'Legume'),
  ('peas',                  array['green peas','pea']::text[], 85, 'Vegetable/legume'),
  ('tomatoes',              array['tomato','tomato paste','tomato puree','diced tomatoes']::text[], 85, 'Vegetable'),
  ('garlic',                array['garlic powder','dried garlic']::text[], 88, 'Vegetable/seasoning'),
  ('onion',                 array['onions','onion powder','dried onion']::text[], 85, 'Vegetable/seasoning'),
  ('almonds',               array['almond','almond butter','sliced almonds']::text[], 88, 'Nut'),
  ('walnuts',               array['walnut']::text[], 90, 'Nut'),
  ('peanuts',               array['peanut','peanut butter','roasted peanuts']::text[], 80, 'Legume/nut'),
  ('sunflower seeds',       array['sunflower kernels']::text[], 85, 'Seed'),
  ('flaxseed',              array['flax seed','ground flaxseed','flax']::text[], 90, 'Seed'),
  ('chia seeds',            array['chia','chia seed']::text[], 90, 'Seed'),
  ('eggs',                  array['egg','whole eggs','egg whites','egg yolks']::text[], 80, 'Whole food'),
  ('chicken',               array['chicken breast','chicken meat']::text[], 75, 'Whole food'),
  ('milk',                  array['whole milk','skim milk','nonfat milk','reduced fat milk','cultured milk']::text[], 70, 'Dairy'),
  ('yogurt',                array['cultured pasteurized milk']::text[], 72, 'Dairy'),
  ('spices',                array['spice','paprika','cinnamon','black pepper','cumin','turmeric','oregano','basil']::text[], 75, 'Seasoning'),
  ('olive oil',             array['extra virgin olive oil','virgin olive oil']::text[], 85, 'Minimally processed oil'),
  ('vinegar',               array['apple cider vinegar','white vinegar','distilled vinegar']::text[], 70, 'Acidulant'),
  ('lemon juice',           array['lemon juice concentrate','lime juice']::text[], 75, 'Acidulant'),
  ('ascorbic acid',         array['vitamin c']::text[], 80, 'Vitamin'),
  -- refined, neutral or mixed
  ('enriched wheat flour',  array['wheat flour','enriched flour','white flour','unbleached enriched flour','bleached wheat flour','enriched bleached wheat flour']::text[], 45, 'Refined grain'),
  ('salt',                  array['sea salt','iodized salt','kosher salt']::text[], 50, 'Sodium source'),
  ('natural flavors',       array['natural flavor','natural flavoring','natural flavourings']::text[], 50, 'Undisclosed blend'),
  ('honey',                 array[]::text[], 45, 'Added sugar, minimally processed'),
  ('cornstarch',            array['corn starch']::text[], 45, 'Refined starch'),
  ('canola oil',            array['rapeseed oil']::text[], 45, 'Refined seed oil'),
  ('sunflower oil',         array[]::text[], 45, 'Refined seed oil'),
  ('potassium sorbate',     array[]::text[], 45, 'Preservative'),
  ('soy lecithin',          array['lecithin','sunflower lecithin']::text[], 55, 'Emulsifier'),
  ('xanthan gum',           array['guar gum','gellan gum','locust bean gum']::text[], 55, 'Thickener'),
  ('citric acid',           array[]::text[], 60, 'Acidulant'),
  ('stevia',                array['stevia extract','steviol glycosides','rebaudioside a']::text[], 55, 'Non-nutritive sweetener'),
  ('monk fruit',            array['monk fruit extract','luo han guo']::text[], 60, 'Non-nutritive sweetener'),
  -- added sugars, refined oils, additives
  ('sugar',                 array['cane sugar','brown sugar','evaporated cane juice','powdered sugar','confectioners sugar','invert sugar','raw sugar']::text[], 25, 'Added sugar'),
  ('dextrose',              array['glucose']::text[], 30, 'Added sugar'),
  ('maltodextrin',          array[]::text[], 30, 'Refined carbohydrate'),
  ('corn syrup',            array['glucose syrup']::text[], 18, 'Added sugar'),
  ('high fructose corn syrup', array['hfcs','glucose fructose syrup','fructose syrup']::text[], 15, 'Added sugar'),
  ('soybean oil',           array[]::text[], 35, 'Refined seed oil'),
  ('vegetable oil',         array['vegetable oil blend','corn oil','cottonseed oil']::text[], 35, 'Refined seed oil'),
  ('palm oil',              array['palm kernel oil','palm fruit oil']::text[], 30, 'Saturated, refined'),
  ('modified corn starch',  array['modified food starch','modified starch']::text[], 35, 'Processed starch'),
  ('sodium benzoate',       array[]::text[], 30, 'Preservative'),
  ('artificial flavors',    array['artificial flavor','artificial flavoring']::text[], 25, 'Synthetic flavoring'),
  ('caramel color',         array['caramel colour']::text[], 25, 'Coloring'),
  ('aspartame',             array[]::text[], 25, 'Artificial sweetener'),
  ('sucralose',             array[]::text[], 30, 'Artificial sweetener'),
  ('sodium nitrite',        array['sodium nitrate']::text[], 20, 'Curing agent'),
  ('red 40',                array['allura red','fd c red no 40','red no 40','red 40 lake']::text[], 12, 'Synthetic dye'),
  ('yellow 5',              array['tartrazine','fd c yellow no 5','yellow no 5']::text[], 12, 'Synthetic dye'),
  ('yellow 6',              array['sunset yellow','fd c yellow no 6','yellow no 6']::text[], 12, 'Synthetic dye'),
  ('blue 1',                array['brilliant blue','fd c blue no 1','blue no 1']::text[], 12, 'Synthetic dye'),
  ('partially hydrogenated oil', array['partially hydrogenated soybean oil','partially hydrogenated vegetable oil','partially hydrogenated cottonseed oil','hydrogenated oil','hydrogenated vegetable oil']::text[], 5, 'Artificial trans fat')
) as v(n, a, s, note);
