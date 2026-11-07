/** Landing copy. The build script renders one language per URL. */
export const copy = {
  pl: {
    lang: 'pl',
    path: '/',
    ogLocale: 'pl_PL',
    ogLocaleAlt: 'en_US',
    title: 'Jinkline — edytor map RPG w SVG',
    description:
      'Rysuj lochy, jaskinie i warowne osady na siatce. Projekt zostaje w JSON, a gotową mapę pobierasz jako SVG albo PNG do VTT.',
    navHome: 'Jinkline, strona główna',
    cta: 'Zacznij rysować',
    ctaSecondary: 'Jak z tego korzystać',
    close: 'Zamknij podgląd',
    zoom: 'Powiększ zrzut',
    eyebrow: 'Edytor map na siatce',
    heroTitle: 'Loch albo osada, które da się później poprawić.',
    heroLead:
      'Jinkline składa mapę z komnat, korytarzy, drzwi i dachów. Zapisujesz jeden plik projektu i wracasz do edycji. Kiedy mapa jest gotowa, eksportujesz wektor albo obraz pod stół.',
    heroCaption: 'Szablon „Krypta Zapomnianego Króla” na klasycznym pergaminie.',
    heroAlt: 'Edytor Jinkline z kryptą narysowaną na jasnym pergaminie.',
    featuresTitle: 'Co rysujesz',
    featuresLead: 'Te same narzędzia obsługują wnętrze lochu i teren na zewnątrz murów.',
    features: [
      {
        title: 'Komnaty i korytarze',
        text: 'Prostokątne sale łączą się same. Korytarz może iść prosto albo załamać się w L.',
      },
      {
        title: 'Jaskinie',
        text: 'Pędzel maluje organiczne groty i tunele. Ściany mogą być proste, ceglane, skalne albo zrujnowane.',
      },
      {
        title: 'Drzwi i schody',
        text: 'Drzwi, bramy, kraty i mosty przyciągają się do ściany. Schody są proste, kręcone albo szerokie.',
      },
      {
        title: 'Tekstury i obiekty',
        text: 'Podłogę malujesz pędzlem albo kubełkiem. Na mapę kładziesz meble SVG i własne grafiki PNG.',
      },
      {
        title: 'Zewnątrz',
        text: 'Dachy, drogi, palisady i mury. Generator zabudowy stawia budynki w wolnych miejscach kwartału.',
      },
      {
        title: 'Styl arkusza',
        text: 'Pergamin, stary zwój, plan architekta albo ciemny arkusz VTT. Zmiana stylu nie rusza geometrii.',
      },
      {
        title: 'Siatka i cofanie',
        text: 'Przyciąganie do kratek trzyma wymiary. Cofanie i ponawianie obejmuje ostatnie zmiany mapy.',
      },
    ],
    settlementCaption: 'Warowna osada: dachy, bruk, palisada i zamek na osobnych warstwach.',
    settlementAlt: 'Edytor Jinkline z osadą, drogami i zamkiem.',
    stepsTitle: 'Jak z tego korzystać',
    steps: [
      {
        title: 'Wybierz punkt startu',
        text: 'Otwórz szablon albo nową pustą mapę. Nazwę mapy zmienisz w polu u góry.',
      },
      {
        title: 'Narysuj plan',
        text: 'We wnętrzu rysujesz komnaty, korytarze i jaskinie. Na warstwie zewnętrznej budynki, drogi i mury.',
      },
      {
        title: 'Dołóż szczegóły',
        text: 'Postaw drzwi, schody, obiekty i numery komnat. Zaznaczenie pozwala je przesunąć, obrócić albo usunąć.',
      },
      {
        title: 'Zapisz projekt',
        text: 'JSON trzyma warstwy i edycję. Ten plik otworzysz później z menu Eksportuj.',
      },
      {
        title: 'Wyeksportuj mapę',
        text: 'SVG zostaje wektorem. PNG jest obrazem pod VTT, z jedną kratką równą 64 pikselom.',
      },
    ],
    tipsTitle: 'Wskazówki przy rysowaniu',
    tips: [
      'Spacja i przeciągnięcie przesuwają widok. Kółko myszy przybliża w miejscu kursora.',
      'Przy korytarzu albo drodze klawisz Tab obraca kolanko.',
      'Drzwi same łapią najbliższą ścianę i obracają się wzdłuż niej.',
      'Kubełek tekstury wypełnia tylko zamknięte pomieszczenie albo dziedziniec. Otwarta przestrzeń nic nie maluje.',
      'Generator zabudowy działa na warstwie zewnętrznej i omija to, co już stoi.',
      'Usuwanie z mapy: zaznacz obiekt i naciśnij Delete.',
    ],
    exportTitle: 'Zapis i eksport',
    exportLead: 'Projekt i gotowa mapa to dwa różne pliki. JSON zostawiasz sobie, SVG albo PNG oddajesz do gry.',
    exportAlt: 'Menu eksportu z opcjami SVG, PNG i JSON.',
    exportCaption: 'Menu Eksportuj: obraz, wektor i plik projektu.',
    exports: [
      {
        kicker: 'JSON',
        title: 'Zapisz projekt',
        text: 'Zostają warstwy, drzwi, tekstury i nazwy. Plik wczytasz z powrotem i rysujesz dalej.',
      },
      {
        kicker: 'SVG',
        title: 'Pobierz wektor',
        text: 'Warstwy mapy i osadzone grafiki PNG. Skaluje się bez rozmywania linii.',
      },
      {
        kicker: 'PNG',
        title: 'Pobierz obraz VTT',
        text: 'Jedna kratka to 64 piksele, a wokół mapy jest margines jednej kratki.',
      },
    ],
    footer: 'Jinkline. Mapy RPG rysowane na siatce.',
  },
  en: {
    lang: 'en',
    path: '/en/',
    ogLocale: 'en_US',
    ogLocaleAlt: 'pl_PL',
    title: 'Jinkline — an SVG RPG map editor',
    description:
      'Draw dungeons, caves, and walled settlements on a grid. Keep the project as JSON, then download the finished map as SVG or a VTT PNG.',
    navHome: 'Jinkline, home',
    cta: 'Start drawing',
    ctaSecondary: 'How to use it',
    close: 'Close preview',
    zoom: 'Enlarge screenshot',
    eyebrow: 'Grid map editor',
    heroTitle: 'A dungeon or a settlement you can still revise.',
    heroLead:
      'Jinkline builds a map from rooms, corridors, doors, and roofs. You save one project file and come back to edit it. When the map is ready, you export a vector or a tabletop image.',
    heroCaption: 'The “Crypt of the Forgotten King” template on classic parchment.',
    heroAlt: 'The Jinkline editor with a crypt drawn on light parchment.',
    featuresTitle: 'What you draw',
    featuresLead: 'The same tools cover a dungeon interior and the ground outside the walls.',
    features: [
      {
        title: 'Rooms and corridors',
        text: 'Rectangular chambers join on their own. A corridor can run straight or turn into an L.',
      },
      {
        title: 'Caves',
        text: 'The brush paints organic caves and tunnels. Walls can be straight, brick, rock, or ruined.',
      },
      {
        title: 'Doors and stairs',
        text: 'Doors, gates, portcullises, and bridges snap to a wall. Stairs are straight, spiral, or wide.',
      },
      {
        title: 'Textures and objects',
        text: 'Paint the floor with a brush or a bucket. Place SVG furniture and your own PNG art.',
      },
      {
        title: 'Exterior',
        text: 'Roofs, roads, palisades, and walls. The building generator fills the open parts of a block.',
      },
      {
        title: 'Sheet style',
        text: 'Parchment, an old scroll, an architect’s plan, or a dark VTT sheet. The geometry stays put.',
      },
      {
        title: 'Grid and undo',
        text: 'Snap keeps the measurements on the squares. Undo and redo cover the latest map changes.',
      },
    ],
    settlementCaption: 'A walled settlement: roofs, cobbles, a palisade, and a castle on separate layers.',
    settlementAlt: 'The Jinkline editor showing a settlement, roads, and a castle.',
    stepsTitle: 'How to use it',
    steps: [
      {
        title: 'Pick a starting point',
        text: 'Open a template or a new blank map. Rename the map in the field at the top.',
      },
      {
        title: 'Draw the plan',
        text: 'Indoors, draw rooms, corridors, and caves. On an exterior layer, draw buildings, roads, and walls.',
      },
      {
        title: 'Add the details',
        text: 'Place doors, stairs, objects, and room numbers. Select one to move, rotate, or delete it.',
      },
      {
        title: 'Save the project',
        text: 'JSON keeps the layers and the edits. Open that file later from the Export menu.',
      },
      {
        title: 'Export the map',
        text: 'SVG stays a vector. PNG is the VTT image, with one square equal to 64 pixels.',
      },
    ],
    tipsTitle: 'While you draw',
    tips: [
      'Hold Space and drag to pan. The mouse wheel zooms toward the cursor.',
      'While drawing a corridor or a road, Tab flips the elbow.',
      'Doors catch the nearest wall and rotate along it.',
      'The texture bucket fills only a closed room or courtyard. Open ground paints nothing.',
      'The building generator runs on an exterior layer and avoids what is already there.',
      'To remove something, select it and press Delete.',
    ],
    exportTitle: 'Saving and export',
    exportLead:
      'The project and the finished map are different files. Keep the JSON, and hand the SVG or PNG to the game.',
    exportAlt: 'The export menu with SVG, PNG, and JSON options.',
    exportCaption: 'The Export menu: image, vector, and the project file.',
    exports: [
      {
        kicker: 'JSON',
        title: 'Save the project',
        text: 'Layers, doors, textures, and names stay in the file. Load it back and keep drawing.',
      },
      {
        kicker: 'SVG',
        title: 'Download the vector',
        text: 'Map layers plus embedded PNG art. It scales without blurring the linework.',
      },
      {
        kicker: 'PNG',
        title: 'Download the VTT image',
        text: 'One square is 64 pixels, with a margin of one square around the map.',
      },
    ],
    footer: 'Jinkline. RPG maps drawn on a grid.',
  },
};
