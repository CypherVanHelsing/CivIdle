import { Building } from "../definitions/BuildingDefinitions";
import { PartialSet } from "../definitions/TypeDefinitions";
import { Singleton, useGameState } from "../Global";
import { Tick } from "../logic/TickLogic";
import { forEach, jsxMapOf } from "../utilities/Helper";
import { L, t } from "../utilities/i18n";
import { MenuComponent } from "./MenuComponent";
import { TilePage } from "./TilePage";

export function WonderPage(): JSX.Element | null {
   const gs = useGameState();
   const builtWonders: PartialSet<Building> = {};
   forEach(gs.tiles, (xy, tile) => {
      if (
         tile.building &&
         Tick.current.buildings[tile.building.type].max == 1 &&
         Tick.current.buildings[tile.building.type].construction
      ) {
         builtWonders[tile.building.type] = true;
      }
   });
   return (
      <div className="window">
         <div className="title-bar">
            <div className="title-bar-text">{t(L.Wonder)}</div>
         </div>
         <MenuComponent />
         <div className="window-body">
            <button
               className="w100"
               onClick={() => Singleton().routeTo(TilePage, { xy: Singleton().buildings.Headquarter.xy })}
            >
               <div className="row jcc">
                  <div className="m-icon" style={{ margin: "0 5px 0 -5px", fontSize: "18px" }}>
                     arrow_back
                  </div>
                  <div>{t(L.BackToHeadquarter)}</div>
               </div>
            </button>
            <div className="sep10"></div>
            <fieldset>
               <legend>{t(L.WondersWiki)}</legend>
               <div className="table-view">
                  <table>
                     <thead>
                        <tr>
                           <th></th>
                           <th>{t(L.GreatPeopleName)}</th>
                           <th>{t(L.GreatPeopleEffect)}</th>
                        </tr>
                     </thead>
                     <tbody>
                        {jsxMapOf(Tick.current.buildings, (b, def) => {
                           if (def.max !== 1 || !def.construction) {
                              return null;
                           }
                           return (
                              <tr>
                                 <td>
                                    {builtWonders[b] ? (
                                       <div className="m-icon small text-green">check_circle</div>
                                    ) : null}
                                 </td>
                                 <td>{def.name()}</td>
                                 <td>{def.desc?.()}</td>
                              </tr>
                           );
                        })}
                     </tbody>
                  </table>
               </div>
            </fieldset>
         </div>
      </div>
   );
}