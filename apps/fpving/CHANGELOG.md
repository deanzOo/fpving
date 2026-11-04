# Changelog

## 0.1.0 (2026-11-04)


### Features

* **api:** composition root, local server and domain api routes ([#14](https://github.com/deanzOo/fpving/issues/14)) ([072ce24](https://github.com/deanzOo/fpving/commit/072ce24908ecee5e3097c4765de5475b5ed5b04d))
* **core:** plugin sdk, pricing, domain model and alert evaluator ([#2](https://github.com/deanzOo/fpving/issues/2)) ([fc182e6](https://github.com/deanzOo/fpving/commit/fc182e63ee8d7e43eb4bc990cd9b2b8240aca03e))
* **db:** sqlite repository and infrastructure adapters ([#6](https://github.com/deanzOo/fpving/issues/6)) ([bb28eb8](https://github.com/deanzOo/fpving/commit/bb28eb87bc12d5894956f7b80a301ee0d1eb717d))
* **plugins:** plugin host with worker runtime and store gateway ([#12](https://github.com/deanzOo/fpving/issues/12)) ([6abe2ab](https://github.com/deanzOo/fpving/commit/6abe2ab7d18dcf19b9b4b6b3bfb5a9710e273215))
* **plugins:** show listings no plugin is scanning on the plugins screen ([#40](https://github.com/deanzOo/fpving/issues/40)) ([82d883c](https://github.com/deanzOo/fpving/commit/82d883c9264dea14858c84e7060233835e5cd0ac))
* **ui:** web ui with six screens served same-origin under a strict csp ([#19](https://github.com/deanzOo/fpving/issues/19)) ([b2a5125](https://github.com/deanzOo/fpving/commit/b2a512512be2f32d93aaa5ceb2283ac44546a4bf))


### Bug Fixes

* **api:** answer a malformed url escape in the error envelope ([#35](https://github.com/deanzOo/fpving/issues/35)) ([6ed6600](https://github.com/deanzOo/fpving/commit/6ed6600adc7f6d58209bc67928b4739509488985))
* **core:** keep listings as they are when their plugin is not loaded ([#32](https://github.com/deanzOo/fpving/issues/32)) ([e3f3691](https://github.com/deanzOo/fpving/commit/e3f3691408c6149a81fd336664fa9209854f0c20))
* **db:** break snapshot ties by append order ([#46](https://github.com/deanzOo/fpving/issues/46)) ([338db63](https://github.com/deanzOo/fpving/commit/338db632ad1a1496faf8e97cba73979b5f48c657))
* **plugins:** bound each plugin's debug pages by age and size ([#39](https://github.com/deanzOo/fpving/issues/39)) ([760a1b2](https://github.com/deanzOo/fpving/commit/760a1b253045ff929c65a101a3df00c66766e05c))
* **plugins:** send only safe headers past a cross-origin redirect ([#37](https://github.com/deanzOo/fpving/issues/37)) ([b3d2d3a](https://github.com/deanzOo/fpving/commit/b3d2d3ad6611e0519c6e7c5c63df5358fd3e1975))
* **plugins:** start plugin workers with an empty environment ([#31](https://github.com/deanzOo/fpving/issues/31)) ([9e3e42b](https://github.com/deanzOo/fpving/commit/9e3e42b97586fbf5476b90517958a06e497d1493))
