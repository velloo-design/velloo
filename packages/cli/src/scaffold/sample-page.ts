/** Elsewhere: the canonical welcome design shared by every provider. */
import type { Board, Screen } from "@velloo/schema";
import elsewhere_discover from "./elsewhere/screens/elsewhere-discover.json" with { type: "json" };
import elsewhere_itinerary from "./elsewhere/screens/elsewhere-itinerary.json" with {
  type: "json",
};
import elsewhere_overview from "./elsewhere/screens/elsewhere-overview.json" with { type: "json" };
import elsewhere_stay from "./elsewhere/screens/elsewhere-stay.json" with { type: "json" };
import elsewhere_trips_board from "./elsewhere/screens/elsewhere-trips-board.json" with {
  type: "json",
};
import elsewhere_trips_journal from "./elsewhere/screens/elsewhere-trips-journal.json" with {
  type: "json",
};
import elsewhere_trips_library from "./elsewhere/screens/elsewhere-trips-library.json" with {
  type: "json",
};
export function buildSampleScreens(): Screen[] {
  return structuredClone([
    elsewhere_discover,
    elsewhere_itinerary,
    elsewhere_overview,
    elsewhere_stay,
    elsewhere_trips_board,
    elsewhere_trips_journal,
    elsewhere_trips_library,
  ] as Screen[]);
}

import elsewhere_details from "./elsewhere/boards/elsewhere-details.json" with { type: "json" };
import main from "./elsewhere/boards/main.json" with { type: "json" };
export function buildSampleBoards(): Board[] {
  return structuredClone([main, elsewhere_details] as Board[]);
}
