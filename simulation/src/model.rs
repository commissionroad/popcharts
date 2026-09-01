use serde::{Deserialize, Serialize};

pub type Coordinate = i64;

pub const COORDINATE_SCALE: Coordinate = 1_000_000;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Yes,
    No,
}

impl Side {
    #[must_use]
    pub const fn opposite(self) -> Self {
        match self {
            Self::Yes => Self::No,
            Self::No => Self::Yes,
        }
    }

    #[must_use]
    pub const fn path_sign(self) -> Coordinate {
        match self {
            Self::Yes => 1,
            Self::No => -1,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Segment {
    pub high: Coordinate,
    pub low: Coordinate,
}

impl Segment {
    #[must_use]
    pub const fn new(low: Coordinate, high: Coordinate) -> Self {
        Self { high, low }
    }

    #[must_use]
    pub const fn width(self) -> Coordinate {
        self.high - self.low
    }
}

#[derive(Clone, Debug)]
pub struct Receipt {
    pub id: u32,
    pub segments: Vec<Segment>,
    pub side: Side,
}

impl Receipt {
    #[must_use]
    pub fn width(&self) -> Coordinate {
        self.segments.iter().map(|segment| segment.width()).sum()
    }
}

#[derive(Clone, Debug)]
pub struct Book {
    pub current_path: Coordinate,
    pub opening_path: Coordinate,
    pub receipts: Vec<Receipt>,
    pub retractions: Vec<RetractionProbe>,
}

#[derive(Clone, Copy, Debug)]
pub struct RetractionProbe {
    pub display_move: f64,
    pub free_cost: f64,
    pub free_width: Coordinate,
}
