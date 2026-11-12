// Interactive figures of the Swift synchronization benchmarks post.
// PostDetails.astro imports this module only on pages that contain one of the elements.
import "./widgets.css";
import { defineActorHops } from "./actor-hops";
import { defineBenchChart } from "./bench-chart";
import { defineInversionTimeline } from "./inversion-timeline";
import { defineMemoryBlocks } from "./memory-blocks";
import { defineTimeRuler } from "./time-ruler";

defineBenchChart();
defineTimeRuler();
defineInversionTimeline();
defineActorHops();
defineMemoryBlocks();
