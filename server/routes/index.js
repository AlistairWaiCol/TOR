import express from 'express';
import authRoutes from './auth.js';
import campaignRoutes from './campaign.js';
import characterRoutes from './characters.js';
import compendiumRoutes from './compendium.js';
import handoutRoutes from './handouts.js';
import mapRoutes from './map.js';
import noteRoutes from './notes.js';
import partyRoutes from './party.js';
import travelRoutes from './travel.js';
import journeyRoutes from './journeys.js';
import rollRoutes from './rolls.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/campaign', campaignRoutes);
router.use('/characters', characterRoutes);
router.use('/compendium', compendiumRoutes);
router.use('/handouts', handoutRoutes);
router.use('/map', mapRoutes);
router.use('/notes', noteRoutes);
router.use('/party', partyRoutes);
router.use('/travel', travelRoutes);
router.use('/journeys', journeyRoutes);
router.use('/rolls', rollRoutes);

export default router;
