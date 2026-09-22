// ── Perchance Art Style Library — COMPLETE (78 styles) ──
// Extracted from Perchance's t2i-styles plugin frame source (2026-08-07).
// Same styles, prompt templates, and negative prompts as the live Perchance UI.
//
// Template syntax:
//   {prompt}     = the user's description (was [input.description])
//   {negative}   = the user's negative prompt (was [input.negative || ""])
//   {len:N}      = user prompt length guard, expanded at render time

export interface ArtStyle {
  name: string;
  prompt: string;
  negative: string | null;
}

export const ART_STYLES: ArtStyle[] = [
  {
    name: "Painted Anime",
    prompt: `{prompt}, art in the style of atey ghailan, painterly anime style at pixiv, art in the style of kantoku, in art style of redjuice/necömi/rella/tiv pixiv collab, your name anime art style, masterpiece digital painting, exquisite lighting and composition, inspired by wlop art style, 8k, sharp, very detailed, high resolution, illustration.\\ painterly anime artwork, {prompt}, world-class masterpiece, fine details, breathtaking artwork, painterly art style, high quality, 8k, very detailed, high resolution, exquisite composition and lighting.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Casual Photo",
    prompt: `A casual real-life photograph. A casual photo of . It's a casual photo. Overall it's an actual real-life photograph.`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Cinematic",
    prompt: `{prompt}, cinematic shot, dynamic lighting, 75mm, Technicolor, Panavision, cinemascope, sharp focus, fine details, 8k, HDR, realism, realistic, key visual, film still, cinematic color grading, depth of field.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Digital Painting",
    prompt: `{prompt}, breathtaking digital art, trending on artstation, in the style of atey ghailan, in the style of greg rutkowski, in the style of greg tocchini, in the style of james gilleard, 8k, high resolution, best quality.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Concept Art",
    prompt: `{prompt}, concept art, digital art, illustration, inspired by wlop style, 8k, fine details, sharp, very detailed, high resolution, world-class masterpiece.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "3D Disney Character",
    prompt: `3D cartoon Disney character portrait render. {prompt}, bokeh, 4k, highly detailed, Pixar render, CGI Animation, Disney, cute big circular reflective eyes, dof, cinematic film, Disney realism, subtle details, breathtaking Pixar short, fine details, close up, sharp focus, HDR, Disney-style octane render, incredible composition, superb lighting and detail, {prompt}.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "2D Disney Character",
    prompt: `2D cartoon Disney character digital art of {prompt}. superb linework, classic 2D Disney style art, inspired in the style of the art styles of Glen Keane and Aaron Blaise, Disney-style character concept with a Disney-style face, trending on artstation, Disney-style version of {prompt}.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Disney Sketch",
    prompt: `Glen Keane character concept art black and white pencil sketch of {prompt}. rough pencil sketch in the style of Glen Keane, rough pencil sketch, close up, loose Disney-style character concept art sketch, nice sketchy pencil strokes, Disney character design sketch, pencil texture, a concept art pencil sketch of {prompt}, in the style of Glen Keane.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Concept Sketch",
    prompt: `black and white technical drawing showcasing {a} {prompt}, annotation details, world-class masterpiece black and white, pencil strokes, annotated technical concept art sketch, pencil texture.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Painterly",
    prompt: `painterly digital painting, {prompt}, digital painting in the style of Ilya Kuvshinov with painterly brush strokes, in the style of Ilya Kuvshinov, world-class painterly masterpiece.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Oil Painting",
    prompt: `breathtaking alla prima oil painting, {prompt}, close up, alla prima style, oil on linen, painterly oil on canvas, painterly style, exquisite composition and lighting, modern painterly masterpiece, in the style of alexi zaitsev, award-winning painterly alla prima oil painting.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Oil Painting - Realism",
    prompt: `breathtaking oil painting, {prompt}, photorealistic oil painting, in the style of charlie bowater, fine details, in the style of wlop, trending on artstation, very detailed.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Oil Painting - Old",
    prompt: `{prompt}, Oil painting in the style of Jean-François Millet and Gustave Courbet and Jules Breton`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Oil Painting - 70s Pulp",
    prompt: `1970s vintage pulp art, ultra realistic, fully restored, exquisite lighting and composition, polished, masterpiece, vintage pulp art, in the style of Earle K. Bergey, in the style of Kelly Freas, in the style of Alex Schomburg, in the style of H. J. Ward, glossy pulp art, Amazing Stories, Weird Tales, 8k, high resolution, best quality, hyper-realistic, Mattias Adolfsson style, detailed stylization, {prompt}, ultra realistic, wlop-style, exquisite lighting and composition, polished, world-class masterpiece, digitally enhanced, breathtaking shot, subtle details, superb quality, art in the style of Kuvshinov, Kuvshinov style, detailed stylization.\\`,
    negative: "[input.negative || \"\"], scratches, faded, washed out, grainy, dirty",
  },
  {
    name: "Professional Photo",
    prompt: `{prompt}, {sharp|soft} focus, depth of field, 8k photo, HDR, professional lighting, taken with Canon EOS R5, DSLR, 75mm lens`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Anime",
    prompt: `anime art of {prompt}, world-class masterpiece, 4k, best quality, anime art.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Drawn Anime",
    prompt: `anime-style illustration with perfect clean lines, illustration of {prompt}, anime drawing/art, bold linework, illustration, cel shaded, anime-style digital illustration. It's an anime-inspired 2D-style anime illustration. Aesthetic high-skill, professional anime illustration, which looks like a screencap from an anime series. It has clean line work and a pleasant, appealing drawn aesthetic style. Overall, it's a world-class illustration with flawless line work, perfect composition, and impeccable attention to detail.`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Anime Screencap",
    prompt: `Anime screencap, {prompt}. It's an anime screencap from a popular anime. Beautiful visual quality, remastered, extremely high quality, very aesthetic, high production value, high-skill masterpiece. The image shows impeccable and beautiful composition and contrast. It's an exquisite anime screencap style image.`,
    negative: "[input.negative || \"\"], faded, washed out, low quality",
  },
  {
    name: "Cute Anime",
    prompt: `adorable, cute, kawaii, {prompt}, cute moe anime character portrait, adorable, featured on pixiv, kawaii moé masterpiece, cuteness overload, very detailed, sooooo adorable.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Soft Anime",
    prompt: `{prompt}, anime masterpiece with soft lighting, gentle intricate style, highly detailed, pixiv, anime art, 4k, art from your name anime, garden of words style art, high quality.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Fantasy Painting",
    prompt: `{prompt}, d&d, fantasy, highly detailed, digital painting, artstation, sharp focus, fantasy art, illustration, 8k, in the style of greg rutkowski. It's an absolute world-class masterpiece artwork. It's an aesthetically pleasing artwork with impeccable attention to detail and impressive composition.`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Fantasy Landscape",
    prompt: `{prompt}, fantasy matte painting, absolute masterpiece, detailed matte painting in the style of andreas rocha and greg rutkowski, in the style of Brothers Hildebrandt, superb composition, vivid fantasy art, breathtaking fantasy masterpiece. It's an absolute world-class masterpiece artwork. It's an aesthetically pleasing artwork with impeccable attention to detail and impressive composition.`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Fantasy Portrait",
    prompt: `{prompt}, d&d, fantasy, highly detailed, digital painting, artstation, sharp focus, fantasy art, character art, illustration, 8k, art in the style of artgerm and greg rutkowski. It's an absolute world-class masterpiece artwork. It's an aesthetically pleasing artwork with impeccable attention to detail and impressive composition.`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Studio Ghibli",
    prompt: `Studio Ghibli style artwork of {prompt}, Studio Ghibli style art film still, sharp, very detailed, high resolution, inspired by the style of Hayao Miyazaki, anime, film still from Spirited Away. In the style of Kiki Delivery Service, with a similar art style to Princess Mononoke. Aesthetically similar to My Neighbor Totoro's art style.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "50s Enamel Sign",
    prompt: `50s enamel sign of {prompt}, 50s advert enamel sign, masterpiece, authentic vintage enamel sign`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Vintage Comic",
    prompt: `comic book style art of {prompt}, drawing, in the style of Dave Stevens, in the style of Adam Hughes, 1940's, 1950's, hand-drawn, color, high resolution, best quality, closeup`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Franco-Belgian Comic",
    prompt: `franco-belgian color comic about {prompt}, bande dessinée, franco-belgian comic panel, masterpiece, breathtaking composition, intricate, detailed, best quality`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Tintin Comic",
    prompt: `color comic panel in the style of Hergé about {prompt}, in the style of Hergé, tintin style, french comic panel, franco-belgian style, masterpiece, high-resolution Hergé style`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Medieval",
    prompt: `medieval illuminated manuscript picture of {prompt}, medieval illuminated manuscript art, masterpiece medieval color illustration, 16th century, 8k high-resolution scan of 16th century illuminated manuscript painting, detailed medieval masterpiece.`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Pixel Art",
    prompt: `{len>40:(pixel art), }{prompt}, best pixel art, neo-geo graphical style, retro nostalgic masterpiece, 128px, 16-bit pixel art {len<10:of {prompt}}, 2D pixel art style, adventure game pixel art, inspired by the art style of hyper light drifter, masterful dithering, superb composition, beautiful palette, exquisite pixel detail`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Furry - Oil",
    prompt: `{prompt}, crisp vibrant detailed soft painterly digital art, volumetric lighting, natural lighting, realistic lighting, vibrant colors, crisp oil painting, painterly realism, depth of field, subtle soft details, vivid, fresh, striking, in the style of chunie, in the style of darkgem, in the style of honovy, inspired by zaush, inspired by anhes, inspired by puinkey, in the style of caraid, in the style of dagasi, inspired by taranfiddler, in the style of atey ghailan, in the style of MilletGustave, in the style of Curbet, inspired by Charlie Bowater style, lol art.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Furry - Cinematic",
    prompt: `{prompt}, cinematic shot, dynamic lighting, 75mm, Technicolor, Panavision, cinemascope, sharp focus, fine details, 8k, HDR, realism, realistic, key visual, film still, cinematic color grading, depth of field.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Furry - Painted",
    prompt: `anthro {prompt} digital art, masterpiece, 4k, fine details. It's an absolute world-class masterpiece artwork.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Furry - Drawn",
    prompt: `anthro {prompt} illustration, hand-drawn, bold linework, anthro illustration, cel shaded, 4k, fine details, masterpiece.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Cute Figurine",
    prompt: `{prompt}, figurine, modern Disney style, octane render, chibi`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "3D Emoji",
    prompt: `masterpiece {prompt} cartoon 3D emoji concept render, close-up, facing forward, matte finish, 3D emoji render, app icon, simple design, new iOS 18.4 style {prompt} emoji render, simple background, centered, world-class masterpiece work of art, crisp render, sharp focus, charmingly aesthetic design, 4k, soft lighting, masterpiece emoji-style figurine 3D render, pure white background`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Illustration",
    prompt: `breathtaking illustration of {prompt}, illustration, masterpiece, breathtaking illustration.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Cute Illustration",
    prompt: `A cute cartoon showing {prompt}, in a soft, cute, minimalist, webcomic-style illustration. Line art is somewhat bold but gentle, with clean lines, and subtle variation. Colors are soft, flat, with gentle pastel tones. No shading except for light inner shadows or simple highlights. The background is plain white or contains a light wash of color with subtle textured style. The overall scene is wholesome and endearing like a page from a Liz Climo comic. Composition is centered with space around the character, evoking authentic warmth through the wholesome, soft, web comic style.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Flat Illustration",
    prompt: `{prompt}, illustration, flat, 2D, vector art, masterpiece, made with adobe illustrator, behance competition winner, trending on dribble, 4k, high resolution, crisp lines.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Watercolor",
    prompt: `{prompt}, (watercolor), high resolution, intricate details, 4k, wallpaper, concept art, watercolor on textured paper.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "1990s Photo",
    prompt: `{prompt}, 90s home video, nostalgic 90s photo, taken with kodak disposable camera`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "1980s Photo",
    prompt: `famous vintage 80s photo, {prompt}, grainy photograph, 80s photo with film grain, Kodacolor II 80s photo with vignetting, retro, r/OldSchoolCool, 80s photo with wear and tear and minor creasing and scratches, vintage color photo`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "1970s Photo",
    prompt: `famous vintage 70s photo, {prompt}, grainy photograph, 1970s photo with film grain, 70s photo with vignetting, retro, r/OldSchoolCool, 70s photo, vintage photo`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "1960s Photo",
    prompt: `famous vintage 60s photo, {prompt}, grainy photograph, 1960s photo with film grain, 60s photo with vignetting, retro, r/OldSchoolCool, 60s photo, vintage photo`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "1950s Photo",
    prompt: `famous vintage 50s photo, {prompt}, grainy photograph, 1950s photo with film grain, 1950s photo with vignetting, retro, r/OldSchoolCool, 1950s photo, vintage photo`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "1940s Photo",
    prompt: `famous vintage 1940s photo, {prompt}, grainy photograph, 1940s photo with film grain, 1940s photo with vignetting, retro, r/OldSchoolCool, 1940s photo, vintage photo`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "1930s Photo",
    prompt: `famous vintage 1930s photo, {prompt}, grainy photograph, 1930s photo with film grain, 1930s photo with vignetting, retro, r/OldSchoolCool, 1930s photo, vintage photo`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "1920s Photo",
    prompt: `famous vintage 1920s photo, {prompt}, 1920s photo, restored photograph, {sepia|black and white}, historical archive photo`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Vintage Pulp Art",
    prompt: `1970s vintage pulp art, {prompt}, vintage pulp art, in the style of Earle K. Bergey, in the style of Kelly Freas, in the style of Alex Schomburg, in the style of H. J. Ward, glossy pulp art, Amazing Stories, Weird Tales, 8k, high resolution, best quality`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "50s Infomercial Anime",
    prompt: `{prompt}, 1950s infomercial style, delicate linework, paprika anime art style, chromatic aberration glow, 2d painted cel animation, soft focus, 2D pixiv 1950s`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "3D Pokemon",
    prompt: `An incredibly perfect high-quality 3D render of a pokemon creature, {prompt}, 8k render, beautiful pokemon digital art, fakemon, pokemon creature, cryptid, fakemon, masterpiece, soft focus, best quality, high quality. Perfect soft lighting, beautiful composition. It's an impressive CGI image from the upcoming Pokemon Movie \\\\(2026\\\\).\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Painted Pokemon",
    prompt: `Beautiful, very high-quality painterly digital concept art, {prompt}, 8k digital painting of a pokemon, amazing pokemon creature art in the style of piperdraws, cryptid creations in the style of Piper Thibodeau, in the style of Naoki Saito and {Tokiya|Mitsuhiro Arita}, incredible composition.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "2D Pokemon",
    prompt: `{prompt}, pokemon creature concept, superb line art, beautiful colors and composition, 2D art style, beautiful pokemon digital art, fakemon, in the style of Sowsow, pokemon creature, cryptid, fakemon, masterpiece, in the style of Yuu Nishida, 4k. The Pokémon-like creature is centered within this anime-style 2D image. It's from the upcoming Pokemon Movie \\\\(2026\\\\) which has the classic 2D Pokemon art style.\\`,
    negative: "[input.negative || \"\"], messy, garbled, confusing, incoherent, unclear",
  },
  {
    name: "Vintage Anime",
    prompt: `{prompt}, 1990s anime, vintage anime, 90's anime style, in the style of hajime sorayama, in the style of greg tocchini, anime masterpiece, pixiv, akira-style art, akira anime art, 4k, high quality.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Neon Vintage Anime",
    prompt: `{prompt}, neon vintage anime style, 90's anime style, 1990s anime, hajime sorayama, greg tocchini, neon vintage anime masterpiece, anime art, 4k, high quality.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Manga",
    prompt: `{prompt}, incredible hand-drawn manga, black and white, in the style of Takehiko Inoue, in the style of Katsuhiro Otomo and akira toriyama manga, hand-drawn art in the style of rumiko takahashi and Inio Asano, Ken Akamatsu manga art.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Fantasy World Map",
    prompt: `beautiful fantasy map of {prompt}, beautiful fantasy map inspired by middle earth and azeroth and discworld and westeros and essos and the witcher world and tamriel and faerûn and thedas, 4k, beautiful colors, crisp, high-resolution artistic map, topographic 3D terrain, artistic map.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Fantasy City Map",
    prompt: `an aerial view of a city, TTRPG city map showing the full city, {prompt}, fantasy art, highly-skilled senior environment artist piece, beautiful fantasy map.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Old World Map",
    prompt: `fantasy world map of {prompt}, fantasy world map, highly detailed digital painting, fantasy art, map illustration, 8k.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "3D Isometric Icon",
    prompt: `{prompt}, 3D isometric render of cute {prompt}, 3D app icon, clean isometric design, beautiful design, soft gradient background, soft colors, centered, 3D blender render, masterpiece, best quality, high resolution, 8k octane render, beautiful color scheme, soft smooth lighting, physically based rendering, square image, high polycount`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Flat Style Icon",
    prompt: `{prompt}, creative icon, flat style icon, masterpiece, high resolution, crisp, beautiful composition and color choice, beautiful flat painted style, behance contest-winner, award winning icon illustration, 8k, best quality`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Flat Style Logo",
    prompt: `beautiful flat-style logo design depicting {prompt}, creative flat-style logo design, trending on dribbble, featured on behance, portfolio piece, minimal flat design, breathtaking graphic design, 8k, high resolution vector logo, plain background, amazingly beautiful logo design, winner of best logo award`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Game Art Icon",
    prompt: `{prompt}, a concept art icon for league of legends, a digital art logo, illustration, league of legends style icon, inspired by wlop style, 8k, dota 2 style icon, fine details, sharp, very detailed icon, high resolution rpg ability/spell/item icon`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Digital Painting Icon",
    prompt: `{prompt}, app logo icon, digital art pictogram icon, trending on artstation, app icon in the style of atey ghailan, app icon in the style of greg rutkowski, app icon in the style of greg tocchini, app icon in the style of james gilleard, 8k, high resolution, best quality`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Concept Art Icon",
    prompt: `{prompt}, a concept art icon, a digital art logo, illustration, league of legends style concept art logo icon, inspired by wlop style, 8k, fine details, sharp, very detailed, high resolution logo icon`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Cute 3D Icon",
    prompt: `{prompt}, a cute 3D icon of {prompt}, cartoon 3D icon, very cute shape, stylized octane render, 8k, masterpiece, soooo cute, beautiful cute perfection, beautiful soft lighting, soft colors, centered, high resolution, {prompt}, soft gradient background`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Cute 3D Icon \ud835\udde6\ud835\uddf2\ud835\ude01",
    prompt: `{prompt}, a set of lovely little 3D icons, cute 3D icons, very cute shapes, stylized octane render, 8k, masterpiece, soooo cute, beautiful cute perfection, beautiful soft lighting, soft colors, centered, high resolution, {prompt}, cute icon set`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Crayon Drawing",
    prompt: `{prompt}, crayon drawing`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Pencil",
    prompt: `black and white pencil drawing, {prompt}, black and white, breathtaking pencil illustration, highly detailed, 4k, textured paper, pencil texture, sketch`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Tattoo Design",
    prompt: `amazing tattoo design, {prompt}, breathtaking tattoo design, incredible tattoo design`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Waifu",
    prompt: `{prompt}, waifu character portrait, 1girl, very high resolution, semi-realistic anime art. Intricate and impressive anime artwork with stunningly beautiful composition and style.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "YuGiOh Art",
    prompt: `yugioh card art for {prompt}, art in the style of genzoman, in the style of Akina Fujiwara, in the style of rossdraws, yugioh monster, close up, painterly details, breathtaking art, centered, masterpiece, amazing composition, {len<30:{prompt}}.\\`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Traditional Japanese",
    prompt: `{prompt}, in ukiyo-e art style, traditional japanese masterpiece`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Nihonga Painting",
    prompt: `japanese nihonga painting about {prompt}, Nihonga, ancient japanese painting, intricate, detailed`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Claymation",
    prompt: `{prompt}, claymation, incredible claymation style, kubo and the two strings style art, Missing Link 2019 art style, clay texture, clay animation, stop-motion clay`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Cartoon",
    prompt: `{prompt}, cartoon-style art, superb linework, nice colors and composition, bold linework, masterpiece, cute art in the style of Dana Terrace, in the style of Rebecca Sugar, in the style of ry-spirit, amazing and wholesome cartoon-style art, cute art style, (trending on artstation)`,
    negative: "[input.negative || \"\"]",
  },
  {
    name: "Cursed Photo",
    prompt: `cursed photo of {prompt}, creepy and cursed, absolutely cursed photo, nope nope nope nope, what the actual f, unsettling photo, cursed_thing, cursedimages, no context, cursed image, bad photo, weird photo, very strange, color photo, creepy photo, nightmare fuel`,
    negative: "[input.negative || \"\"]",
  },
];

// Render the style template against a concrete user prompt. Handles the
// {len:N:...} guards and {replace-realistic} token from Perchance templates.
export function renderStylePrompt(style: ArtStyle, userPrompt: string, userNegative: string | null): string {
  let p = style.prompt
    .replace(/\{prompt\}/g, userPrompt)
    .replace(/\{negative\}/g, userNegative ?? "")
    .replace(/\{len<10:([^}]*)\}/g, (_, t) => (userPrompt.length < 10 ? t.replace("{prompt}", userPrompt) : ""))
    .replace(/\{len<30:([^}]*)\}/g, (_, t) => (userPrompt.length < 30 ? t.replace("{prompt}", userPrompt) : ""))
    .replace(/\{len>40:([^}]*)\}/g, (_, t) => (userPrompt.length > 40 ? t : ""))
    .replace(/\{replace-realistic\}/g, userPrompt.replace(/\b(realistic)\b/i, "actual"))
  // collapse double spaces
  return p.replace(/\s{2,}/g, " ").trim();
}

export function resolveStyle(name: string | null | undefined): ArtStyle | null {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  return ART_STYLES.find((s) => s.name.toLowerCase() === n) ?? null;
}
