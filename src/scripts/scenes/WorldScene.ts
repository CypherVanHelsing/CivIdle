import { SmoothGraphics } from "@pixi/graphics-smooth";
import type { FederatedPointerEvent, IPointData, Sprite, utils } from "pixi.js";
import { Color, Container, LINE_CAP, LINE_JOIN, ParticleContainer, TilingSprite } from "pixi.js";
import { TILE_SIZE, getGameOptions, getGameState } from "../Global";
import { GameFeature, hasFeature } from "../logic/FeatureLogic";
import type { GameOptions, GameState } from "../logic/GameState";
import { TilePage } from "../ui/TilePage";
import { clamp, forEach, lerp, lookAt, pointToXy, xyToPoint } from "../utilities/Helper";
import { ViewportScene } from "../utilities/SceneManager";
import { Singleton } from "../utilities/Singleton";
import { Vector2, v2 } from "../utilities/Vector2";
import { Actions } from "../utilities/pixi-actions/Actions";
import { Easing } from "../utilities/pixi-actions/Easing";
import type { Action } from "../utilities/pixi-actions/actions/Action";
import { CustomAction } from "../utilities/pixi-actions/actions/CustomAction";
import { TileVisual } from "./TileVisual";
import { TooltipPool } from "./TooltipPool";
import { TransportPool } from "./TransportPool";

let viewportCenter: IPointData | null = null;
let viewportZoom: number | null = null;

export class WorldScene extends ViewportScene {
   private _width!: number;
   private _height!: number;
   private _selectedGraphics!: SmoothGraphics;
   private _transportLines!: SmoothGraphics;
   private _transportPool!: TransportPool;
   public tooltipPool!: TooltipPool;
   private cameraMovement: Action | null = null;
   private readonly _tiles: utils.Dict<TileVisual> = {};
   private readonly _transport: Map<number, Sprite> = new Map();
   private _bg!: TilingSprite;
   private _graphics!: SmoothGraphics;
   private _selectedXy: string | null = null;

   override onLoad(): void {
      const { app, textures } = this.context;
      const maxPosition = Singleton().grid.maxPosition();
      this._width = maxPosition.x;
      this._height = maxPosition.y;

      this.viewport.setWorldSize(this._width, this._height);
      this.viewport.setZoomRange(
         Math.max(app.screen.width / this._width, app.screen.height / this._height),
         2,
      );

      this._bg = this.viewport.addChild(new TilingSprite(textures.Paper, this._width, this._height));
      this._bg.tint = Color.shared.setValue(getGameOptions().themeColors.WorldBackground);
      this._bg.position.set((this._width - this._bg.width) / 2, (this._height - this._bg.height) / 2);

      this._graphics = this.viewport.addChild(new SmoothGraphics()).lineStyle({
         color: 0xffffff,
         width: 2,
         cap: LINE_CAP.ROUND,
         join: LINE_JOIN.ROUND,
         alignment: 0.5,
      });
      this._graphics.alpha = 0.1;
      Singleton().grid.drawGrid(this._graphics);

      Singleton().grid.forEach((grid) => {
         const xy = pointToXy(grid);
         this._tiles[xy] = this.viewport.addChild(new TileVisual(this, grid));
      });

      this.tooltipPool = new TooltipPool(this.viewport.addChild(new Container()));
      this._transportPool = new TransportPool(
         textures.Transport,
         this.viewport.addChild(
            new ParticleContainer(1500, {
               position: true,
               rotation: true,
               alpha: true,
            }),
         ),
      );
      this._selectedGraphics = this.viewport.addChild(new SmoothGraphics());
      this._transportLines = this.viewport.addChild(new SmoothGraphics());

      if (viewportZoom) {
         this.viewport.zoom = viewportZoom;
      }

      if (!viewportCenter) {
         viewportCenter = { x: this._width / 2, y: this._height / 2 };
      }
      this.viewport.center = viewportCenter;

      this.viewport.on("moved", () => {
         viewportCenter = this.viewport.center;
         viewportZoom = this.viewport.zoom;
      });

      this.viewport.on("clicked", (e: FederatedPointerEvent) => {
         const grid = Singleton().grid.positionToGrid(this.viewport.screenToWorld(e));
         if (e.button === 2) {
            return;
         }
         this.selectGrid(grid);
      });

      this.selectGrid(xyToPoint(Singleton().buildings.Headquarter.xy));
   }

   override onResize(width: number, height: number): void {
      super.onResize(width, height);
      const { app } = this.context;
      this.viewport.setZoomRange(
         Math.max(app.screen.width / this._width, app.screen.height / this._height),
         2,
      );
   }

   override onGameStateChanged(gameState: GameState): void {
      forEach(this._tiles, (xy, visual) => visual.onTileDataChanged(gameState.tiles[xy]));
      this.drawTransportation(gameState);
   }

   override onGameOptionsChanged(gameOptions: GameOptions): void {
      this._bg.tint = Color.shared.setValue(gameOptions.themeColors.WorldBackground);
      this._graphics.tint = Color.shared.setValue(gameOptions.themeColors.GridColor);
      this._graphics.alpha = gameOptions.themeColors.GridAlpha;
      this._selectedGraphics.tint = Color.shared.setValue(gameOptions.themeColors.SelectedGridColor);
      forEach(this._tiles, (xy, visual) => visual.updateDepositColor(gameOptions));
   }

   lookAtXy(xy: string) {
      this.cameraMovement?.stop();
      const target = this.viewport.clampCenter(Singleton().grid.xyToPosition(xy));
      this.cameraMovement = new CustomAction(
         () => viewportCenter,
         (v) => {
            viewportCenter = v;
            this.viewport.center = viewportCenter!;
         },
         (a, b, f) => {
            if (a && b) {
               return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
            }
            throw new Error(`Cannot interpolate from a = ${a} to b = ${b}`);
         },
         target,
         v2(target).subtractSelf(viewportCenter!).length() / 2000,
         Easing.InOutSine,
      ).start();
      this.drawSelection(xyToPoint(xy));
   }

   drawSelection(grid: IPointData) {
      if (!this._selectedGraphics) {
         return;
      }
      this._selectedGraphics.clear();
      if (Singleton().grid.isEdge(grid)) {
         return;
      }
      this._selectedGraphics.lineStyle({
         color: 0xffffff,
         width: 2,
         cap: LINE_CAP.ROUND,
         join: LINE_JOIN.ROUND,
         alignment: 0.5,
      });

      Singleton().grid.drawSelected(grid, this._selectedGraphics);
   }

   selectGrid(grid: IPointData) {
      this.drawSelection(grid);
      const xy = pointToXy(grid);
      this._selectedXy = xy;
      Singleton().routeTo(TilePage, { xy: xy });
      const gs = getGameState();
      this.drawTransportation(gs);
      this.drawBuildingDecors(gs);
   }

   private drawBuildingDecors(gs: GameState) {
      const xy = this._selectedXy;
      if (!xy) {
         return;
      }
      const building = gs.tiles[xy].building;
      const grid = xyToPoint(xy);
      if (building) {
         switch (building.type) {
            case "MausoleumAtHalicarnassus": {
               const pos = Singleton().grid.gridToPosition(grid);

               this._selectedGraphics.lineStyle({ width: 0 });
               this._selectedGraphics.beginFill(0xffffff, 0.2, true);
               this._selectedGraphics.drawCircle(pos.x, pos.y, TILE_SIZE * 4);
               this._selectedGraphics.endFill();

               break;
            }
            case "Warehouse": {
               if (hasFeature(GameFeature.WarehouseUpgrade, gs)) {
                  this.highlightAdjacentTiles(grid);
               }
               break;
            }
            case "ColossusOfRhodes":
            case "LighthouseOfAlexandria":
            case "HangingGarden":
            case "ChichenItza":
            case "AngkorWat":
            case "StatueOfZeus":
            case "Poseidon":
            case "EiffelTower":
            case "BrandenburgGate":
            case "SummerPalace":
            case "StatueOfLiberty":
               this.highlightAdjacentTiles(grid);
               break;
         }
      }
   }

   private drawTransportation(gs: GameState) {
      const xy = this._selectedXy;
      if (!xy) {
         return;
      }
      this._transportLines.clear();
      const lines: Record<string, true> = {};
      gs.transportation[xy]?.forEach((t) => {
         const fromGrid = xyToPoint(t.fromXy);
         const toGrid = xyToPoint(t.toXy);
         const key = [t.resource, (fromGrid.y - toGrid.y) / (fromGrid.x - toGrid.x)].join(",");
         if (lines[key]) {
            return;
         }
         lines[key] = true;
         this._transportLines.lineStyle({
            color: Color.shared.setValue(getGameOptions().resourceColors[t.resource] ?? "#ffffff"),
            width: 2,
            cap: LINE_CAP.ROUND,
            join: LINE_JOIN.ROUND,
            alignment: 0.5,
            alpha: 0.25,
         });
         this._transportLines.moveTo(t.fromPosition.x, t.fromPosition.y);
         this._transportLines.lineTo(t.toPosition.x, t.toPosition.y);
      });
   }

   private highlightAdjacentTiles(grid: IPointData) {
      Singleton()
         .grid.getNeighbors(grid)
         .forEach((neighbor) => {
            this._selectedGraphics.lineStyle({ width: 0 });
            this._selectedGraphics.beginFill(0xffffff, 0.2, true);
            Singleton().grid.drawSelected(neighbor, this._selectedGraphics);
            this._selectedGraphics.endFill();
         });
   }

   getTile(xy: string): TileVisual | undefined {
      return this._tiles[xy];
   }

   resetTile(xy: string): void {
      this._tiles[xy]?.destroy({ children: true });
      this._tiles[xy] = this.viewport.addChild(new TileVisual(this, xyToPoint(xy)));
   }

   private _ticked: Set<number> = new Set();

   updateTransportVisual(gs: GameState, timeSinceLastTick: number) {
      this._ticked.clear();
      const options = getGameOptions();
      forEach(gs.transportation, (xy, transports) => {
         transports.forEach((t) => {
            if (!this._transport.get(t.id)) {
               const visual = this._transportPool.allocate();
               visual.position = t.fromPosition;
               visual.tint = Color.shared.setValue(options.resourceColors[t.resource] ?? "#ffffff");
               lookAt(visual, t.toPosition);
               this._transport.set(t.id, visual);
            } else if (t.hasEnoughFuel) {
               const visual = this._transport.get(t.id);
               visual!.position = Vector2.lerp(
                  t.fromPosition,
                  t.toPosition,
                  (t.ticksSpent + timeSinceLastTick) / t.ticksRequired,
               );
               // This is the last tick
               if (t.ticksSpent >= t.ticksRequired - 1) {
                  visual!.alpha = lerp(
                     options.themeColors.TransportIndicatorAlpha,
                     0,
                     clamp(timeSinceLastTick - 0.5, 0, 0.5) * 2,
                  );
               }
            }
            this._ticked.add(t.id);
         });
      });

      for (const [id, sprite] of this._transport) {
         if (!this._ticked.has(id)) {
            this._transportPool.release(sprite);
            this._transport.delete(id);
         }
      }
   }

   public cameraPan(target_: number, time: number): void {
      const { app } = this.context;
      if (this._selectedXy) {
         this.viewport.center = Singleton().grid.xyToPosition(this._selectedXy);
      }
      const target = clamp(
         target_,
         Math.max(app.screen.width / this._width, app.screen.height / this._height),
         2,
      );
      Actions.to(this.viewport, { zoom: target }, time).start();
   }
}
