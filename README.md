# Drift World — Practice

A drift practice game that runs in the browser. Pick a car, pick a location, and learn to hold a slide.

- **Cars:** Toyota Supra RZ (A80), Porsche 911 GT3 (992), Ferrari F8 Tributo
- **Locations:** Neon Downtown (night city grid with a plaza), Touge Pass (2.1 km mountain loop with 60 m of climb), Harbour Terminal (open apron with a skidpad and a wet low-grip pad)
- **Gearbox:** automatic or sequential manual

Built with [Three.js](https://threejs.org) and [Vite](https://vite.dev). There are no downloaded assets: car bodies, scenery, textures and sound are all generated in code.

## Controls

| Key | Action |
| --- | --- |
| `↑` | Throttle |
| `↓` | Brake. In automatic, hold at a standstill to select reverse |
| `←` `→` | Steer |
| `Space` | Handbrake (rear wheels, opens the clutch) |
| `E` / `W` | Gear up / gear down (manual) |
| `R` | Put the car back on the road |
| `C` | Cycle camera: chase, far, bonnet, overhead |
| `M` | Mute |
| `H` | Hide the key hints |
| `Esc` or `P` | Pause |

A gamepad also works: left stick steers, triggers are throttle and brake, `A` is the handbrake, bumpers shift.

## How to drift

1. Build speed in second gear, turn in, and tap the handbrake to break the rear loose.
2. Get back on the throttle. Wheelspin keeps the rear sliding.
3. Ease off the steering as the car rotates. With the countersteer assist on, the front wheels follow the slide on their own, the way a real steering wheel spins back through your hands.
4. More throttle means more angle; lifting straightens the car.

Points build with speed and angle, the multiplier grows the longer you hold the slide and with each change of direction, and the run is banked when you straighten up. Touching a wall or spinning loses the run.

## Physics

The vehicle model lives in `src/physics` and runs at a fixed 1000 Hz.

- Four wheels, each with its own rotational speed, on a planar rigid body.
- Combined-slip tyre model (normalised Magic Formula) with load sensitivity and lateral relaxation. A spinning wheel loses side grip and a locked wheel slides along its velocity, so power oversteer and handbrake entries come out of the model rather than being scripted.
- Load transfer through roll and pitch states of the sprung mass, so weight shifts take time and a flick before the corner works.
- Engine torque curves, turbo lag, rev limiter, engine braking, clutch, gearbox and a clutch-type limited-slip differential. Clutch, differential, brakes and tyre reaction are solved together as friction constraints.
- Aerodynamic drag and downforce, rolling resistance, road gradient, ABS on the foot brake.
- Car figures (mass, weight distribution, wheelbase, gear ratios, torque curves) follow the production cars. All three run the same mild drift setup: harder rear tyres, a tight differential, a hydraulic handbrake and extra steering lock. The Supra is tuned to 550 hp.

`npm run test:physics` runs the model headlessly and prints 0–100 km/h, braking distance, skidpad grip and whether a slide can be held, for each car.

The countersteer assist is a driver aid on the steering only: it does not change tyre grip or add forces. Turn it off in the menu for unassisted steering.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
```

`/dev/cars.html?car=supra&view=front34` is a viewer for the car models, available on the dev server only.

A link can start a session directly: `/?car=gt3&track=mountain&gearbox=manual&go`. Cars are `supra`, `gt3`, `f8`; tracks are `city`, `mountain`, `docks`.

## Deploying to Netlify

`netlify.toml` already sets the build command (`npm run build`) and the publish directory (`dist`). In Netlify choose **Add new site → Import an existing project**, select this repository and deploy.

## Notes

The car models are procedural approximations made for this project, not licensed or scanned models. Car and manufacturer names belong to their owners and are used only to identify the vehicles being simulated; this project is not affiliated with or endorsed by them.
